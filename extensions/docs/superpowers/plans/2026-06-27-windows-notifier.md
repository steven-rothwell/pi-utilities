# Windows Notifier Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pi extension that shows native Windows toast notifications with configurable sounds when the agent finishes, encounters provider errors, or tool errors.

**Architecture:** Single TypeScript extension file with PowerShell-based Windows toast notifications. Config stored in `~/.pi/agent/extensions/windows-notifier.json`. Interactive `/notifier` command for configuration with sound preview.

**Tech Stack:** TypeScript, Node.js child_process (execFile for PowerShell), pi ExtensionAPI

## Global Constraints

- Extension file location: `~/.pi/agent/extensions/windows-notifier.ts`
- Config file location: `~/.pi/agent/extensions/windows-notifier.json`
- Windows-only (uses PowerShell toast notifications)
- No external npm dependencies — uses Node.js built-ins only

---

## File Structure

| File | Responsibility |
|------|----------------|
| `~/.pi/agent/extensions/windows-notifier.ts` | Main extension: event listeners, notification logic, /notifier command |
| `~/.pi/agent/extensions/windows-notifier.json` | User config (created on first /notifier use or manually) |

---

### Task 1: Create Extension Scaffold with Config Loading

**Files:**
- Create: `~/.pi/agent/extensions/windows-notifier.ts`

**Interfaces:**
- Consumes: pi ExtensionAPI
- Produces: `NotConfig` type, `loadConfig()` function, `saveConfig()` function

- [ ] **Step 1: Create the extension file with types and config functions**

```typescript
// ~/.pi/agent/extensions/windows-notifier.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

function getConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, CONFIG_FILE);
}

function loadConfig(cwd: string): NotifierConfig {
  const configPath = getConfigPath(cwd);
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

function saveConfig(cwd: string, config: NotifierConfig): void {
  const configPath = getConfigPath(cwd);
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export default function (pi: ExtensionAPI) {
  let config: NotifierConfig = DEFAULT_CONFIG;

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
  });

  // Placeholder for event listeners and command - will be added in subsequent tasks
}
```

- [ ] **Step 2: Test that extension loads without errors**

Run: `pi -e ~/.pi/agent/extensions/windows-notifier.ts -p "hello"`
Expected: Extension loads, no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add ~/.pi/agent/extensions/windows-notifier.ts
git commit -m "feat(notifier): add extension scaffold with config loading"
```

---

### Task 2: Add Windows Toast Notification Function

**Files:**
- Modify: `~/.pi/agent/extensions/windows-notifier.ts`

**Interfaces:**
- Consumes: Config loaded in Task 1
- Produces: `notifyWindows(title, body, sound)` function

- [ ] **Step 1: Add the Windows notification function**

Add after the `saveConfig` function, before the `export default function`:

```typescript
function notifyWindows(title: string, body: string, sound: string): void {
  const { execFile } = require("child_process");

  // Build toast XML with audio
  const xml = [
    "<toast>",
    "  <visual>",
    "    <binding template='ToastText02'>",
    `      <text id='1'>${escapeXml(title)}</text>`,
    `      <text id='2'>${escapeXml(body)}</text>`,
    "    </binding>",
    "  </visual>",
    `  <audio src='${sound}'/>`,
    "</toast>",
  ].join("");

  // PowerShell command to show toast
  const psScript = [
    "$type = 'Windows.UI.Notifications'",
    "$mgr = [ToastNotificationManager, $type, ContentType = WindowsRuntime]",
    "$template = [ToastTemplateType]::ToastText02",
    "$xml = [ToastNotificationManager]::GetTemplateContent($template)",
    "$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('" + escapePs(title) + "')) > $null",
    "$xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode('" + escapePs(body) + "')) > $null",
    "$toast = [ToastNotification]::new($xml)",
    "[ToastNotificationManager]::CreateToastNotifier('Pi').Show($toast)",
  ].join("; ");

  execFile("powershell.exe", ["-NoProfile", "-Command", psScript], () => {});
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapePs(text: string): string {
  return text.replace(/'/g, "''");
}
```

- [ ] **Step 2: Commit**

```bash
git add ~/.pi/agent/extensions/windows-notifier.ts
git commit -m "feat(notifier): add Windows toast notification function"
```

---

### Task 3: Add Event Listeners for All Status Types

**Files:**
- Modify: `~/.pi/agent/extensions/windows-notifier.ts`

**Interfaces:**
- Consumes: `config` object, `notifyWindows()` function
- Produces: Event handlers for agent_end, after_provider_response, tool_execution_end

- [ ] **Step 1: Add event listeners inside the default export function**

Replace the placeholder comment with:

```typescript
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
```

- [ ] **Step 2: Test notification triggers**

Run: `pi -e ~/.pi/agent/extensions/windows-notifier.ts`
Send a message and verify toast appears when agent finishes.
Expected: Windows toast notification with "Ready for input"

- [ ] **Step 3: Commit**

```bash
git add ~/.pi/agent/extensions/windows-notifier.ts
git commit -m "feat(notifier): add event listeners for agent, provider, and tool status"
```

---

### Task 4: Add /notifier Command with Toggle and Sound Selection

**Files:**
- Modify: `~/.pi/agent/extensions/windows-notifier.ts`

**Interfaces:**
- Consumes: `config`, `loadConfig()`, `saveConfig()`, `AVAILABLE_SOUNDS`
- Produces: `/notifier` command with interactive menu

- [ ] **Step 1: Add the /notifier command**

Add inside the default export function, after the event listeners:

```typescript
  pi.registerCommand("notifier", {
    description: "Configure Windows notification settings",
    handler: async (_args, ctx) => {
      const action = await ctx.ui.select("Notification Settings:", [
        { value: "toggle", label: "Toggle notifications on/off" },
        { value: "sound", label: "Change notification sounds" },
        { value: "test", label: "Test notification" },
      ]);

      if (!action) return;

      if (action === "toggle") {
        const notifType = await ctx.ui.select("Which notification:", [
          { value: "agentFinished", label: "Agent Finished" },
          { value: "providerError", label: "Provider Error" },
          { value: "toolError", label: "Tool Error" },
        ]);

        if (!notifType) return;

        const current = config.notifications[notifType as NotificationType];
        const newState = !current.enabled;
        config.notifications[notifType as NotificationType].enabled = newState;
        saveConfig(ctx.cwd, config);
        ctx.ui.notify(`${notifType} notifications ${newState ? "enabled" : "disabled"}`, "info");
      }

      if (action === "sound") {
        const notifType = await ctx.ui.select("Which notification:", [
          { value: "agentFinished", label: "Agent Finished" },
          { value: "providerError", label: "Provider Error" },
          { value: "toolError", label: "Tool Error" },
        ]);

        if (!notifType) return;

        const soundChoice = await ctx.ui.select(
          "Select sound (plays preview):",
          AVAILABLE_SOUNDS.map((s) => ({ value: s.value, label: s.label }))
        );

        if (!soundChoice) return;

        // Play preview
        notifyWindows("Preview", "This is how the notification sounds", soundChoice);

        config.notifications[notifType as NotificationType].sound = soundChoice;
        saveConfig(ctx.cwd, config);
        ctx.ui.notify(`Sound updated for ${notifType}`, "info");
      }

      if (action === "test") {
        const notifType = await ctx.ui.select("Test which notification:", [
          { value: "agentFinished", label: "Agent Finished" },
          { value: "providerError", label: "Provider Error" },
          { value: "toolError", label: "Tool Error" },
        ]);

        if (!notifType) return;

        const cfg = config.notifications[notifType as NotificationType];
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

        notifyWindows(titles[notifType], bodies[notifType], cfg.sound);
        ctx.ui.notify("Test notification sent", "info");
      }
    },
  });
```

- [ ] **Step 2: Test the /notifier command**

Run: `pi -e ~/.pi/agent/extensions/windows-notifier.ts`
Type `/notifier` in the editor.
Expected: Interactive menu appears with toggle, sound, and test options

- [ ] **Step 3: Test toggle functionality**

Select "Toggle notifications on/off" → select "Agent Finished"
Expected: Config file updated, notification disabled

- [ ] **Step 4: Test sound change with preview**

Select "Change notification sounds" → select "Agent Finished" → select "IM"
Expected: Preview notification plays, config saved

- [ ] **Step 5: Test notification**

Select "Test notification" → select "Agent Finished"
Expected: Toast notification appears with configured sound

- [ ] **Step 6: Commit**

```bash
git add ~/.pi/agent/extensions/windows-notifier.ts
git commit -m "feat(notifier): add /notifier command with toggle, sound selection, and preview"
```

---

### Task 5: Final Integration Test

**Files:**
- Verify: `~/.pi/agent/extensions/windows-notifier.ts`

**Interfaces:**
- Consumes: All previous tasks
- Produces: Fully working extension

- [ ] **Step 1: Full integration test**

Run: `pi -e ~/.pi/agent/extensions/windows-notifier.ts`

Test scenarios:
1. Send a message → agent processes → toast appears when done
2. Run `/notifier` → toggle agentFinished off → send message → no toast
3. Run `/notifier` → change sound → test notification plays new sound
4. Delete config file → extension uses defaults → no errors

- [ ] **Step 2: Verify config file creation**

Check that `~/.pi/agent/extensions/windows-notifier.json` exists after running `/notifier`

- [ ] **Step 3: Final commit**

```bash
git add ~/.pi/agent/extensions/windows-notifier.ts
git commit -m "feat(notifier): Windows notifier extension complete"
```
