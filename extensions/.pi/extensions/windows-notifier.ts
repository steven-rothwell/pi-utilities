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
