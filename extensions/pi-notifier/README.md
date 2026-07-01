# pi-notifier

Windows desktop notifications for Pi. Get notified when the agent finishes, when API errors occur, or when tools fail.

## Features

- **Agent Finished** - Know when Pi is ready for your next input
- **Provider Error** - Instant alerts for HTTP 4xx/5xx errors (rate limits, auth failures, etc.)
- **Tool Error** - Get notified when any tool execution fails
- **Focus Detection** - Notifications are suppressed when Pi's terminal is already focused (no redundant popups)
- **Custom Sounds** - Choose from 13 Windows system sounds or disable sounds per notification type
- **Dark/Light Theme** - Stylish toast popups with a modern look

## Screenshots

| | Agent Finished | Provider Error | Tool Error |
|---|---|---|---|
| **Dark** | ![Dark Agent Finished](https://raw.githubusercontent.com/steven-rothwell/pi-utilities/master/extensions/pi-notifier/screenshots/dark-agent-finished.png) | ![Dark Provider Error](https://raw.githubusercontent.com/steven-rothwell/pi-utilities/master/extensions/pi-notifier/screenshots/dark-provider-error.png) | ![Dark Tool Error](https://raw.githubusercontent.com/steven-rothwell/pi-utilities/master/extensions/pi-notifier/screenshots/dark-tool-error.png) |
| **Light** | ![Light Agent Finished](https://raw.githubusercontent.com/steven-rothwell/pi-utilities/master/extensions/pi-notifier/screenshots/light-agent-finished.png) | ![Light Provider Error](https://raw.githubusercontent.com/steven-rothwell/pi-utilities/master/extensions/pi-notifier/screenshots/light-provider-error.png) | ![Light Tool Error](https://raw.githubusercontent.com/steven-rothwell/pi-utilities/master/extensions/pi-notifier/screenshots/light-tool-error.png) |

## Install

```bash
pi install npm:@steven-rothwell/pi-notifier
```

## Configure

Run the `/notifier` command in Pi's TUI to:

- Toggle notifications on/off per type
- Change notification sounds
- Switch between dark and light themes
- Test notifications before enabling

```bash
/notifier
```

## Requirements

- **Windows** - Uses PowerShell and WinForms for native notifications
- **Pi** - Requires `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`

## Configuration File

Settings are stored in `~/.pi/notifier.json`. You can edit this file directly:

```json
{
  "theme": "dark",
  "notifications": {
    "agentFinished": {
      "enabled": true,
      "sound": "C:\\Windows\\Media\\Windows Notify Messaging.wav"
    },
    "providerError": {
      "enabled": true,
      "sound": "C:\\Windows\\Media\\Windows Error.wav"
    },
    "toolError": {
      "enabled": true,
      "sound": "C:\\Windows\\Media\\Windows Exclamation.wav"
    }
  }
}
```

## How It Works

Pi-notifier hooks into three Pi events:

1. `agent_end` - Fires when the agent finishes processing and is waiting for input
2. `after_provider_response` - Fires on HTTP 4xx/5xx responses from AI providers
3. `tool_execution_end` - Fires when any tool execution fails (`isError: true`)

Before showing a notification, it checks if Pi's terminal is the foreground window. If it is, the notification is skipped since you're already looking at Pi.

## License

MIT
