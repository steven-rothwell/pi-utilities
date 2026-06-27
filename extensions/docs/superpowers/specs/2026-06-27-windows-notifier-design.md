# Windows Notifier Extension Design

## Overview

A pi extension that shows native Windows toast notifications when specific agent events occur, with configurable sounds per status type.

## Status Types & Default Messages

| Status | Trigger | Title | Default Sound |
|--------|---------|-------|---------------|
| **Agent Finished** | `agent_end` | "Pi" | `ms-winsoundevent:Notification.IM` |
| **Provider Error** | `after_provider_response` (4xx/5xx) | "Pi Error" | `ms-winsoundevent:Notification.Looping.Alarm` |
| **Tool Error** | `tool_execution_end` (isError) | "Pi Tool Error" | `ms-winsoundevent:Notification.Looping.Alarm2` |

### Notification Messages

Fixed messages that clearly describe the status:

- **Agent Finished**: Body = "Ready for input"
- **Provider Error**: Body = "API request failed (HTTP {status})"
- **Tool Error**: Body = "Tool '{toolName}' failed"

## Configuration

### Config File

Location: `~/.pi/agent/extensions/windows-notifier.json`

```json
{
  "notifications": {
    "agentFinished": {
      "enabled": true,
      "sound": "ms-winsoundevent:Notification.IM"
    },
    "providerError": {
      "enabled": true,
      "sound": "ms-winsoundevent:Notification.Looping.Alarm"
    },
    "toolError": {
      "enabled": true,
      "sound": "ms-winsoundevent:Notification.Looping.Alarm2"
    }
  }
}
```

### Default Behavior

- All notifications enabled by default
- Config file is optional — extension works without it
- If config file missing or malformed, use defaults silently

## Command: /notifier

Interactive configuration menu with the following options:

1. **Toggle notifications** — Enable/disable each notification type
2. **Change sound** — Pick from list of available Windows notification sounds

### Available Sounds

- `ms-winsoundevent:Notification.Default`
- `ms-winsoundevent:Notification.IM`
- `ms-winsoundevent:Notification.Mail`
- `ms-winsoundevent:Notification.Reminder`
- `ms-winsoundevent:Notification.SMS`
- `ms-winsoundevent:Notification.Looping.Alarm`
- `ms-winsoundevent:Notification.Looping.Alarm2`
- `ms-winsoundevent:Notification.Looping.Call`
- `ms-winsoundevent:Notification.Looping.SMS`

## Implementation

### File Structure

Single extension file: `~/.pi/agent/extensions/windows-notifier.ts`

### Event Listeners

1. **`agent_end`** — Agent finished, waiting for user input
2. **`after_provider_response`** — Check for HTTP errors (status >= 400)
3. **`tool_execution_end`** — Check for tool errors (event.isError === true)

### Windows Toast Notification

Uses PowerShell with Windows Runtime API:

```typescript
function notifyWindows(title: string, body: string, sound: string): void {
  const { execFile } = require("child_process");
  const xml = buildToastXml(title, body, sound);
  execFile("powershell.exe", ["-NoProfile", "-Command", xml]);
}
```

Toast XML includes `<audio>` element with configurable sound URI.

### Config Loading

- Load config on `session_start`
- Cache in memory
- Reload on `/notifier` command changes
- Graceful fallback to defaults on any error

## Error Handling

- Missing config file: use defaults
- Invalid config JSON: use defaults, log warning
- PowerShell execution failure: silently ignore (non-critical)
- Invalid sound URI: use default sound for that notification type

## Testing

1. Manual test: run `pi -e ./windows-notifier.ts` and trigger each status
2. Test config file creation and modification
3. Test `/notifier` command interaction
4. Test with missing/malformed config
