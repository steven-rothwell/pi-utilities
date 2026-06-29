// ~/.pi/agent/extensions/windows-notifier.ts
//
// Windows desktop notifications for Pi.
//
// Notifications come from three events: agent_end, after_provider_response
// (HTTP 4xx/5xx), and tool_execution_end (tool errors). Each can be toggled
// on/off independently and assigned its own .wav sound (or "No sound").
//
// Run `/notifier` in Pi's TUI to configure.

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Component,
  type SelectItem,
  SelectList,
  type SettingItem,
  SettingsList,
  Text,
  type TUI,
} from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types & configuration
// ---------------------------------------------------------------------------

type NotificationType = "agentFinished" | "providerError" | "toolError";
type ThemeName = "dark" | "light";

interface NotificationConfig {
  enabled: boolean;
  sound: string; // path to a .wav (or "" for silent)
}

interface NotifierConfig {
  theme: ThemeName;
  notifications: Record<NotificationType, NotificationConfig>;
}

const CONFIG_FILE = "windows-notifier.json";

const DEFAULT_CONFIG: NotifierConfig = {
  theme: "dark",
  notifications: {
    agentFinished: {
      enabled: true,
      sound: "C:\\Windows\\Media\\Windows Notify Messaging.wav",
    },
    providerError: {
      enabled: true,
      sound: "C:\\Windows\\Media\\Windows Error.wav",
    },
    toolError: {
      enabled: true,
      sound: "C:\\Windows\\Media\\Windows Exclamation.wav",
    },
  },
};

// Sound values are direct .wav paths under C:\Windows\Media.
const AVAILABLE_SOUNDS: { value: string; label: string }[] = [
  { value: "", label: "No sound" },
  { value: "C:\\Windows\\Media\\Windows Default.wav", label: "Default" },
  { value: "C:\\Windows\\Media\\Windows Notify System Generic.wav", label: "Notify Generic" },
  { value: "C:\\Windows\\Media\\Windows Notify Messaging.wav", label: "Notify Messaging" },
  { value: "C:\\Windows\\Media\\Windows Notify Email.wav", label: "Notify Email" },
  { value: "C:\\Windows\\Media\\Windows Notify Calendar.wav", label: "Notify Calendar" },
  { value: "C:\\Windows\\Media\\Windows Notify.wav", label: "Notify" },
  { value: "C:\\Windows\\Media\\Windows Ding.wav", label: "Ding" },
  { value: "C:\\Windows\\Media\\Windows Exclamation.wav", label: "Exclamation" },
  { value: "C:\\Windows\\Media\\Windows Background.wav", label: "Background" },
  { value: "C:\\Windows\\Media\\Windows Balloon.wav", label: "Balloon" },
  { value: "C:\\Windows\\Media\\Windows Error.wav", label: "Error" },
  { value: "C:\\Windows\\Media\\Windows Ringin.wav", label: "Ringin" },
];

const SOUND_LABELS = new Map(AVAILABLE_SOUNDS.map((s) => [s.value, s.label]));

// Static metadata for each notification type. `title`/`body` are reused for the
// test-notification preview; the real event handlers below attach
// event-specific values where relevant.
const NOTIF_TYPES: { key: NotificationType; label: string; title: string; body: string }[] = [
  { key: "agentFinished", label: "Agent Finished", title: "Pi", body: "Ready for input" },
  { key: "providerError", label: "Provider Error", title: "Pi Error", body: "API request failed (HTTP 429)" },
  { key: "toolError", label: "Tool Error", title: "Pi Tool Error", body: "Tool 'bash' failed" },
];

function notifLabel(key: NotificationType): string {
  return NOTIF_TYPES.find((t) => t.key === key)?.label ?? key;
}

/** Known sound values include every entry in AVAILABLE_SOUNDS. */
const KNOWN_SOUNDS = new Set(AVAILABLE_SOUNDS.map((s) => s.value));

function describeSound(value: string): string {
  const label = SOUND_LABELS.get(value);
  if (label !== undefined) return label;
  // Handle Windows sound event URIs: extract the last dotted segment as a
  // human-readable name (e.g. "Notification.Looping.Alarm" → "Looping Alarm").
  if (value.startsWith("ms-winsoundevent:")) {
    return value
      .slice("ms-winsoundevent:".length)
      .replace(/^Notification\./, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return value;
}

function formatTheme(theme: ThemeName): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

function getConfigPath(): string {
  return join(homedir(), ".pi", CONFIG_FILE);
}

function loadConfig(): NotifierConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<NotifierConfig>;
    const merged: NotifierConfig = {
      theme: parsed.theme ?? DEFAULT_CONFIG.theme,
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...parsed.notifications,
      },
    };
    return sanitizeConfig(merged);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Reset any unrecognized sound values to the per-type default. */
function sanitizeConfig(cfg: NotifierConfig): NotifierConfig {
  let dirty = false;
  const VALID_THEMES: ThemeName[] = ["dark", "light"];
  if (!VALID_THEMES.includes(cfg.theme)) {
    cfg.theme = DEFAULT_CONFIG.theme;
    dirty = true;
  }
  for (const key of Object.keys(DEFAULT_CONFIG.notifications) as NotificationType[]) {
    const sound = cfg.notifications[key]?.sound;
    if (sound === undefined || !KNOWN_SOUNDS.has(sound)) {
      cfg.notifications[key] = {
        ...cfg.notifications[key],
        enabled: cfg.notifications[key]?.enabled ?? DEFAULT_CONFIG.notifications[key].enabled,
        sound: DEFAULT_CONFIG.notifications[key].sound,
      };
      dirty = true;
    }
  }
  if (dirty) saveConfig(cfg);
  return cfg;
}

function saveConfig(config: NotifierConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}

// Shared mutable config — loaded on session_start, mutated by the menus.
let config: NotifierConfig = DEFAULT_CONFIG;

// ---------------------------------------------------------------------------
// Windows interop
// ---------------------------------------------------------------------------

/** Escape a string for embedding inside PowerShell single-quoted strings. */
function escapePs(text: string): string {
  return text.replace(/'/g, "''");
}

/** Play a .wav once via PowerShell (fire-and-forget). */
function playSound(soundFile: string): void {
  if (!soundFile) return;
  // Backslashes work inside PowerShell single quotes, but normalizing to
  // forward slashes sidesteps any argv/parsing quirks along the way.
  const safePath = soundFile.replace(/\\/g, "/");
  const psScript = `(New-Object System.Media.SoundPlayer '${escapePs(safePath)}').PlaySync()`;
  execFile("powershell.exe", ["-NoProfile", "-Command", psScript], () => {});
}

/**
 * Accent colours for the notification popup's left bar.
 * Mapped by notification level so errors get red, info gets blue.
 */
const ACCENT_COLORS: Record<string, [number, number, number]> = {
  info: [0, 120, 212],
  error: [216, 59, 1],
  warning: [255, 185, 0],
};

interface ThemeColors {
  background: [number, number, number];
  title: [number, number, number];
  body: [number, number, number];
  border: [number, number, number];
}

const THEME_COLORS: Record<ThemeName, ThemeColors> = {
  light: {
    background: [255, 255, 255],
    title: [30, 30, 30],
    body: [80, 80, 80],
    border: [210, 210, 210],
  },
  dark: {
    background: [32, 32, 34],
    title: [240, 240, 240],
    body: [170, 170, 170],
    border: [60, 60, 60],
  },
};

/**
 * Show a visual notification popup and play the configured sound.
 *
 * Uses a custom WinForms form styled as a modern toast notification instead of
 * NotifyIcon.ShowBalloonTip, because ShowBalloonTip always triggers the
 * Windows system notification sound with no way to suppress it. A custom form
 * gives us full control: we show a styled popup and play only the configured
 * .wav via playSound.
 */
function notifyWindows(
  title: string,
  body: string,
  sound: string,
  level: "info" | "error" | "warning" = "info",
): void {
  playSound(sound);

  const [ar, ag, ab] = ACCENT_COLORS[level] ?? ACCENT_COLORS.info;
  const theme = THEME_COLORS[config.theme] ?? THEME_COLORS.dark;
  const [bgR, bgG, bgB] = theme.background;
  const [titleR, titleG, titleB] = theme.title;
  const [bodyR, bodyG, bodyB] = theme.body;
  const [borderR, borderG, borderB] = theme.border;
  const safeTitle = escapePs(title);
  const safeBody = escapePs(body);

  // The Win32 P/Invoke type is wrapped in try/catch so re-runs within the
  // same PowerShell session don't error on a duplicate type name.
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try { Add-Type -TypeDefinition '
using System; using System.Runtime.InteropServices;
public class NotifWin32 {
    [DllImport("Gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int x,int y,int w,int h,int ew,int eh);
    [DllImport("User32.dll")] public static extern int SetWindowRgn(IntPtr hWnd,IntPtr hRgn,bool bRedraw);
}' } catch {}
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'; $f.StartPosition = 'Manual'
$f.Size = New-Object System.Drawing.Size(380, 110)
$f.BackColor = [System.Drawing.Color]::FromArgb(${bgR},${bgG},${bgB})
$f.TopMost = $true; $f.ShowInTaskbar = $false; $f.Opacity = 0
$scr = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$f.Location = New-Object System.Drawing.Point(($scr.Right - 390), ($scr.Bottom - 120))
try { $r = [NotifWin32]::CreateRoundRectRgn(0,0,$f.Width,$f.Height,14,14); [NotifWin32]::SetWindowRgn($f.Handle,$r,$true) | Out-Null } catch {}
$bar = New-Object System.Windows.Forms.Panel
$bar.Size = New-Object System.Drawing.Size(5, 110); $bar.Location = New-Object System.Drawing.Point(0, 0)
$bar.BackColor = [System.Drawing.Color]::FromArgb(${ar},${ag},${ab})
$f.Controls.Add($bar)
$tl = New-Object System.Windows.Forms.Label
$tl.Text = '${safeTitle}'; $tl.AutoSize = $false
$tl.Size = New-Object System.Drawing.Size(355, 26); $tl.Location = New-Object System.Drawing.Point(18, 16)
$tl.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 11)
$tl.ForeColor = [System.Drawing.Color]::FromArgb(${titleR},${titleG},${titleB})
$f.Controls.Add($tl)
$bl = New-Object System.Windows.Forms.Label
$bl.Text = '${safeBody}'; $bl.AutoSize = $false
$bl.Size = New-Object System.Drawing.Size(355, 50); $bl.Location = New-Object System.Drawing.Point(18, 46)
$bl.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$bl.ForeColor = [System.Drawing.Color]::FromArgb(${bodyR},${bodyG},${bodyB})
$f.Controls.Add($bl)
$f.Add_Paint({ param($s,$e); $p = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(${borderR},${borderG},${borderB}),1); $e.Graphics.DrawRectangle($p,0,0,($f.Width-1),($f.Height-1)); $p.Dispose() })
$fi = New-Object System.Windows.Forms.Timer; $fi.Interval = 15
$fi.Add_Tick({ $f.Opacity = [Math]::Min(1.0, $f.Opacity + 0.12); if($f.Opacity -ge 1.0){$fi.Stop();$fi.Dispose()} })
$fi.Start()
$ct = New-Object System.Windows.Forms.Timer; $ct.Interval = 5000
$ct.Add_Tick({ $f.Close(); $ct.Dispose() })
$ct.Start()
$f.ShowDialog() | Out-Null; $f.Dispose()
`.trim();

  execFile("powershell.exe", ["-NoProfile", "-Command", psScript], () => {});
}

// ---------------------------------------------------------------------------
// Menu UI (TUI only)
//
// Each menu is a custom component that stays alive across actions. This fixes
// the previous bug where re-invoking ctx.ui.select() after every Enter sent
// the cursor back to the first item — the cursor now stays where the user
// left it. Only Esc/Back returns to the parent menu.
// ---------------------------------------------------------------------------

interface ThemeContext {
  theme: Theme;
  tui: TUI;
}

interface ListPickerOptions extends ThemeContext {
  title: string;
  hint: string;
  /** Fresh SelectItem[] reflecting current config (labels may change after picks). */
  itemsFactory: () => SelectItem[];
  /** Value to pre-select on open (cursor stays on the current item). */
  initialSelectedValue?: string;
  /** Called on Enter. May mutate config; labels refresh from itemsFactory after. */
  onPick: (item: SelectItem) => void;
  /** Called on Esc; should invoke the parent's submenu done() callback. */
  onClose: () => void;
}

function makeListPicker(opts: ListPickerOptions): Component {
  const items = opts.itemsFactory();
  const selectList = new SelectList(items, Math.min(items.length, 12), getSelectListTheme());

  if (opts.initialSelectedValue !== undefined) {
    const idx = items.findIndex((i) => i.value === opts.initialSelectedValue);
    if (idx >= 0) selectList.setSelectedIndex(idx);
  }

  selectList.onSelect = (item) => {
    opts.onPick(item);
    // Refresh labels (e.g. the "(•)" marker moved, or a toggle flipped).
    const fresh = opts.itemsFactory();
    for (let i = 0; i < items.length && i < fresh.length; i++) {
      items[i].label = fresh[i].label;
    }
  };
  selectList.onCancel = () => opts.onClose();

  return wrapContainer(opts, opts.title, opts.hint, selectList, selectList);
}

interface SettingsSubmenuResult {
  component: Component;
  settingsList: SettingsList;
}

interface SettingsSubmenuOptions extends ThemeContext {
  title: string;
  items: SettingItem[];
  onChange: (id: string, newValue: string) => void;
  onCancel: () => void;
}

function makeSettingsSubmenu(opts: SettingsSubmenuOptions): SettingsSubmenuResult {
  const container = new Container();
  container.addChild(new DynamicBorder((s) => opts.theme.fg("accent", s)));
  container.addChild(new Text(opts.theme.fg("accent", opts.theme.bold(opts.title))));

  const settingsList = new SettingsList(
    opts.items,
    opts.items.length + 2,
    getSettingsListTheme(),
    opts.onChange,
    opts.onCancel,
  );
  // SettingsList already renders its own "Enter/Space to change · Esc to cancel" hint.
  container.addChild(settingsList);

  container.addChild(new DynamicBorder((s) => opts.theme.fg("accent", s)));

  return {
    settingsList,
    component: {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        settingsList.handleInput?.(data);
        opts.tui.requestRender();
      },
    },
  };
}

/** Wrap an inner Component in a bordered container with a title + hint. */
function wrapContainer(
  ctx: ThemeContext,
  title: string,
  hint: string,
  body: Component,
  input: Component,
): Component {
  const container = new Container();
  container.addChild(new DynamicBorder((s) => ctx.theme.fg("accent", s)));
  container.addChild(new Text(ctx.theme.fg("accent", ctx.theme.bold(title))));
  container.addChild(body);
  container.addChild(new Text(ctx.theme.fg("dim", hint)));
  container.addChild(new DynamicBorder((s) => ctx.theme.fg("accent", s)));

  return {
    render: (width) => container.render(width),
    invalidate: () => container.invalidate(),
    handleInput: (data) => {
      input.handleInput?.(data);
      ctx.tui.requestRender();
    },
  };
}

/** Toggle a notification type's enabled flag (stays open for further toggles). */
function makeTogglePicker(ctx: ThemeContext, close: () => void): Component {
  const itemsFactory = () =>
    NOTIF_TYPES.map((t) => ({
      value: t.key,
      label: `${config.notifications[t.key].enabled ? "[x]" : "[ ]"} ${t.label}`,
    }));

  return makeListPicker({
    ...ctx,
    title: "Toggle notifications on/off",
    hint: "↑↓ navigate · enter toggles · esc back",
    itemsFactory,
    onPick: (item) => {
      const meta = NOTIF_TYPES.find((t) => t.key === item.value);
      if (meta) {
        config.notifications[meta.key].enabled = !config.notifications[meta.key].enabled;
        saveConfig(config);
      }
    },
    onClose: close,
  });
}

/** Pick the notification type whose sound you want to configure, then drill in. */
function makeSoundTypePicker(ctx: ThemeContext, close: () => void): Component {
  const items: SettingItem[] = NOTIF_TYPES.map((t) => ({
    id: t.key,
    label: t.label,
    currentValue: describeSound(config.notifications[t.key].sound),
    submenu: (_cv, soundDone) => makeSoundPicker(t.key, ctx, soundDone),
  }));

  // Capture the SettingsList so we can refresh its labels in place when a
  // sound changes.
  const { component, settingsList } = makeSettingsSubmenu({
    ...ctx,
    title: "Change notification sounds",
    items,
    onChange: (id, soundValue) => {
      const meta = NOTIF_TYPES.find((t) => t.key === (id as NotificationType));
      if (meta) {
        // SettingsList already updated currentValue to the raw path; persist
        // and switch the display back to the human-friendly label.
        config.notifications[meta.key].sound = soundValue;
        saveConfig(config);
        settingsList.updateValue(meta.key, describeSound(soundValue));
      }
    },
    onCancel: close,
  });

  return component;
}

/** Pick a .wav (or "No sound") for one notification type, previewing on Enter. */
function makeSoundPicker(
  notifType: NotificationType,
  ctx: ThemeContext,
  close: (soundValue: string | undefined) => void,
): Component {
  const itemsFactory = () =>
    AVAILABLE_SOUNDS.map((s) => ({
      value: s.value,
      label: `${s.value === config.notifications[notifType].sound ? "(•)" : "( )"} ${s.label}`,
    }));

  return makeListPicker({
    ...ctx,
    title: `${notifLabel(notifType)} — Select sound`,
    hint: "↑↓ navigate · enter previews & sets · esc back",
    itemsFactory,
    initialSelectedValue: config.notifications[notifType].sound,
    onPick: (item) => {
      config.notifications[notifType].sound = item.value;
      saveConfig(config);
      // Preview only the sound — no balloon during sound selection.
      playSound(item.value);
    },
    onClose: () => close(config.notifications[notifType].sound),
  });
}

/** Fire a test notification + sound for one notification type (stays open). */
function makeTestPicker(ctx: ThemeContext, close: () => void): Component {
  const itemsFactory = () => NOTIF_TYPES.map((t) => ({ value: t.key, label: t.label }));

  return makeListPicker({
    ...ctx,
    title: "Test notification",
    hint: "↑↓ navigate · enter tests · esc back",
    itemsFactory,
    onPick: (item) => {
      const meta = NOTIF_TYPES.find((t) => t.key === item.value);
      if (meta) {
        const level = meta.key === "agentFinished" ? "info" : "error";
        notifyWindows(meta.title, meta.body, config.notifications[meta.key].sound, level);
      }
    },
    onClose: close,
  });
}

/** Select Dark or Light theme for the notification popup. */
function makeThemePicker(
  ctx: ThemeContext,
  onThemeChanged: () => void,
  close: () => void,
): Component {
  const itemsFactory = () =>
    (["dark", "light"] as ThemeName[]).map((t) => ({
      value: t,
      label: `${config.theme === t ? "(•)" : "( )"} ${formatTheme(t)}`,
    }));

  return makeListPicker({
    ...ctx,
    title: "Select theme",
    hint: "↑↓ navigate · enter selects · esc back",
    itemsFactory,
    initialSelectedValue: config.theme,
    onPick: (item) => {
      config.theme = item.value as ThemeName;
      saveConfig(config);
      onThemeChanged();
    },
    onClose: close,
  });
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    config = loadConfig();
  });

  // Agent finished - waiting for user input
  pi.on("agent_end", async () => {
    const cfg = config.notifications.agentFinished;
    if (!cfg.enabled) return;
    notifyWindows("Pi", "Ready for input", cfg.sound, "info");
  });

  // Provider error - HTTP 4xx/5xx
  pi.on("after_provider_response", async (event) => {
    const cfg = config.notifications.providerError;
    if (!cfg.enabled || event.status < 400) return;
    notifyWindows("Pi Error", `API request failed (HTTP ${event.status})`, cfg.sound, "error");
  });

  // Tool error - tool execution failed
  pi.on("tool_execution_end", async (event) => {
    const cfg = config.notifications.toolError;
    if (!cfg.enabled || !event.isError) return;
    notifyWindows("Pi Tool Error", `Tool '${event.toolName}' failed`, cfg.sound, "error");
  });

  pi.registerCommand("notifier", {
    description: "Configure Windows notification settings",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/notifier requires TUI mode", "warning");
        return;
      }

      await ctx.ui.custom<undefined>((tui, theme, _kb, done) => {
        const themeCtx: ThemeContext = { theme, tui };

        let settingsList: SettingsList;

        const rootItems: SettingItem[] = [
          {
            id: "toggle",
            label: "Toggle notifications on/off",
            currentValue: "",
            submenu: (_cv, subDone) => makeTogglePicker(themeCtx, () => subDone(undefined)),
          },
          {
            id: "sounds",
            label: "Change notification sounds",
            currentValue: "",
            submenu: (_cv, subDone) =>
              makeSoundTypePicker(themeCtx, () => subDone(undefined)),
          },
          {
            id: "themes",
            label: "Themes",
            currentValue: formatTheme(config.theme),
            submenu: (_cv, subDone) =>
              makeThemePicker(
                themeCtx,
                () => settingsList.updateValue("themes", formatTheme(config.theme)),
                () => subDone(undefined),
              ),
          },
          {
            id: "test",
            label: "Test notification",
            currentValue: "",
            submenu: (_cv, subDone) => makeTestPicker(themeCtx, () => subDone(undefined)),
          },
        ];

        const submenu = makeSettingsSubmenu({
          ...themeCtx,
          title: "Notification Settings",
          items: rootItems,
          onChange: () => {},
          onCancel: () => done(undefined),
        });
        settingsList = submenu.settingsList;
        return submenu.component;
      });
    },
  });
}