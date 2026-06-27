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

function notifyWindows(title: string, body: string, sound: string): void {
  const { execFile } = require("child_process");

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

function escapePs(text: string): string {
  return text.replace(/'/g, "''");
}

export default function (pi: ExtensionAPI) {
  let config: NotifierConfig = DEFAULT_CONFIG;

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
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
}
