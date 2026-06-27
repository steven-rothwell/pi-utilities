// ~/.pi/agent/extensions/windows-notifier.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type NotificationType = "agentFinished" | "providerError" | "toolError";

interface NotificationConfig {
  enabled: boolean;
  sound: string;
}

interface NotifierConfig {
  notifications: Record<NotificationType, NotificationConfig>;
}

const CONFIG_DIR_NAME = ".pi";
const CONFIG_FILE = "windows-notifier.json";

const DEFAULT_CONFIG: NotifierConfig = {
  notifications: {
    agentFinished: {
      enabled: true,
      sound: "ms-winsoundevent:Notification.IM",
    },
    providerError: {
      enabled: true,
      sound: "ms-winsoundevent:Notification.Looping.Alarm",
    },
    toolError: {
      enabled: true,
      sound: "ms-winsoundevent:Notification.Looping.Alarm2",
    },
  },
};

const AVAILABLE_SOUNDS = [
  { value: "", label: "No sound" },
  { value: "ms-winsoundevent:Notification.Default", label: "Default" },
  { value: "ms-winsoundevent:Notification.IM", label: "IM" },
  { value: "ms-winsoundevent:Notification.Mail", label: "Mail" },
  { value: "ms-winsoundevent:Notification.Reminder", label: "Reminder" },
  { value: "ms-winsoundevent:Notification.SMS", label: "SMS" },
  { value: "ms-winsoundevent:Notification.Looping.Alarm", label: "Looping Alarm" },
  { value: "ms-winsoundevent:Notification.Looping.Alarm2", label: "Looping Alarm 2" },
  { value: "ms-winsoundevent:Notification.Looping.Call", label: "Looping Call" },
  { value: "ms-winsoundevent:Notification.Looping.SMS", label: "Looping SMS" },
];

function getConfigPath(): string {
  return join(homedir(), ".pi", CONFIG_FILE);
}

function loadConfig(): NotifierConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NotifierConfig>;
    return {
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...parsed.notifications,
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: NotifierConfig): void {
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

function notifyWindows(title: string, body: string, sound: string): void {
  const { execFile } = require("child_process");
  const appId = "PiCodingAgent";

  // PowerShell to show toast notification with proper app registration and custom sound
  const psScript = [
    // Register app for notifications
    `$startMenu = [Environment]::GetFolderPath('StartMenu')`,
    `$shortcutPath = Join-Path $startMenu 'Programs\Pi.lnk'`,
    `if (!(Test-Path $shortcutPath)) {`,
    `  $shell = New-Object -ComObject WScript.Shell`,
    `  $shortcut = $shell.CreateShortcut($shortcutPath)`,
    `  $shortcut.TargetPath = 'powershell.exe'`,
    `  $shortcut.Arguments = '-NoExit'`,
    `  $shortcut.WorkingDirectory = $env:USERPROFILE`,
    `  $shortcut.AppUserModelID = '${appId}'`,
    `  $shortcut.Save()`,
    `}`,
    // Show toast with sound
    `$ntfType = 'Windows.UI.Notifications'`,
    `$mgr = [ToastNotificationManager, $ntfType, ContentType = WindowsRuntime]`,
    `$toastXml = [$ntfType.ToastTemplateType]::ToastText02`,
    `$xml = [$ntfType.ToastNotificationManager]::GetTemplateContent($toastXml)`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${escapePs(title)}')) > $null`,
    `$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('${escapePs(body)}')) > $null`,
    ...(sound ? [
      `$audio = $xml.CreateElement('audio', 'http://schemas.microsoft.com/windows/2006/08/actions/toast')`,
      `$audio.SetAttribute('src', '${sound}') > $null`,
      `$xml.DocumentElement.AppendChild($audio) > $null`,
    ] : [
      `$audio = $xml.CreateElement('audio', 'http://schemas.microsoft.com/windows/2006/08/actions/toast')`,
      `$audio.SetAttribute('silent', 'true') > $null`,
      `$xml.DocumentElement.AppendChild($audio) > $null`,
    ]),
    `$toast = [$ntfType.ToastNotification]::new($xml)`,
    `[ToastNotificationManager]::CreateToastNotifier('${appId}').Show($toast)`,
  ].join("; ");

  execFile("powershell.exe", ["-NoProfile", "-Command", psScript], () => {});
}

function escapePs(text: string): string {
  return text.replace(/'/g, "''");
}

export default function (pi: ExtensionAPI) {
  let config: NotifierConfig = DEFAULT_CONFIG;

  pi.on("session_start", async () => {
    config = loadConfig();
  });

  // Agent finished - waiting for user input
  pi.on("agent_end", async () => {
    if (!config.notifications.agentFinished.enabled) return;
    notifyWindows("Pi", "Ready for input", config.notifications.agentFinished.sound);
  });

  // Provider error - HTTP 4xx/5xx
  pi.on("after_provider_response", async (event) => {
    if (!config.notifications.providerError.enabled) return;
    if (event.status >= 400) {
      notifyWindows(
        "Pi Error",
        `API request failed (HTTP ${event.status})`,
        config.notifications.providerError.sound
      );
    }
  });

  // Tool error - tool execution failed
  pi.on("tool_execution_end", async (event) => {
    if (!config.notifications.toolError.enabled) return;
    if (event.isError) {
      notifyWindows(
        "Pi Tool Error",
        `Tool '${event.toolName}' failed`,
        config.notifications.toolError.sound
      );
    }
  });

  const NOTIF_TYPES: { key: NotificationType; label: string }[] = [
    { key: "agentFinished", label: "Agent Finished" },
    { key: "providerError", label: "Provider Error" },
    { key: "toolError", label: "Tool Error" },
  ];

  async function showToggleMenu(ctx: any): Promise<void> {
    while (true) {
      const items = [
        ...NOTIF_TYPES.map((t) => ({
          label: `${config.notifications[t.key].enabled ? "[x]" : "[ ]"} ${t.label}`,
          value: t.key,
        })),
        { label: "← Back", value: "back" },
      ];

      const choice = await ctx.ui.select("Toggle notifications:", items.map((i) => i.label));
      if (!choice || choice === "← Back") return;

      const item = items.find((i) => i.label === choice);
      if (item && item.value !== "back") {
        const notifType = item.value as NotificationType;
        config.notifications[notifType].enabled = !config.notifications[notifType].enabled;
        saveConfig(config);
      }
    }
  }

  async function showSoundMenu(ctx: any): Promise<void> {
    while (true) {
      const notifType = await ctx.ui.select("Select notification type:", [
        ...NOTIF_TYPES.map((t) => t.label),
        "← Back",
      ]);
      if (!notifType || notifType === "← Back") return;

      const selectedType = NOTIF_TYPES.find((t) => t.label === notifType);
      if (!selectedType) continue;

      while (true) {
        const currentSound = config.notifications[selectedType.key].sound;
        const soundItems = [
          ...AVAILABLE_SOUNDS.map((s) => ({
            label: `${s.value === currentSound ? "(•)" : "( )"} ${s.label}`,
            value: s.value,
          })),
          { label: "← Back", value: "back" },
        ];

        const choice = await ctx.ui.select(
          `${notifType} - Select sound (plays preview):`,
          soundItems.map((i) => i.label)
        );
        if (!choice || choice === "← Back") break;

        const item = soundItems.find((i) => i.label === choice);
        if (item && item.value !== "back") {
          notifyWindows("Preview", "This is how the notification sounds", item.value);
          config.notifications[selectedType.key].sound = item.value;
          saveConfig(config);
        }
      }
    }
  }

  async function showTestMenu(ctx: any): Promise<void> {
    while (true) {
      const choice = await ctx.ui.select("Test notification:", [
        ...NOTIF_TYPES.map((t) => t.label),
        "← Back",
      ]);
      if (!choice || choice === "← Back") return;

      const selectedType = NOTIF_TYPES.find((t) => t.label === choice);
      if (!selectedType) continue;

      const cfg = config.notifications[selectedType.key];
      const titles: Record<string, string> = {
        agentFinished: "Pi",
        providerError: "Pi Error",
        toolError: "Pi Tool Error",
      };
      const bodies: Record<string, string> = {
        agentFinished: "Ready for input",
        providerError: "API request failed (HTTP 429)",
        toolError: "Tool 'bash' failed",
      };

      notifyWindows(titles[selectedType.key], bodies[selectedType.key], cfg.sound);
      ctx.ui.notify("Test notification sent", "info");
    }
  }

  pi.registerCommand("notifier", {
    description: "Configure Windows notification settings",
    handler: async (_args, ctx) => {
      while (true) {
        const action = await ctx.ui.select("Notification Settings:", [
          "Toggle notifications on/off",
          "Change notification sounds",
          "Test notification",
          "← Exit",
        ]);

        if (!action || action === "← Exit") return;

        if (action === "Toggle notifications on/off") {
          await showToggleMenu(ctx);
        } else if (action === "Change notification sounds") {
          await showSoundMenu(ctx);
        } else if (action === "Test notification") {
          await showTestMenu(ctx);
        }
      }
    },
  });
}
