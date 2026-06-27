# Task 1: Create Extension Scaffold with Config Loading

## Context

You are building a Windows notification extension for pi (a terminal coding agent). This is the first task - creating the extension scaffold with config loading.

The extension will show Windows toast notifications when:
- Agent finishes and is waiting for input
- Provider errors occur (HTTP 4xx/5xx)
- Tool execution errors occur

## Requirements

Read the task brief at: `C:/GitLocal/pi-utilities/.superpowers/sdd/task-1-brief.md`

This contains the exact code to create. Follow it precisely.

## Interfaces

- Consumes: pi ExtensionAPI (from `@earendil-works/pi-coding-agent`)
- Produces: `NotConfig` type, `loadConfig()` function, `saveConfig()` function

## File Location

Create the extension file at: `~/.pi/agent/extensions/windows-notifier.ts`

Note: `~` expands to the user's home directory (C:\Users\scuba on Windows).

## Steps

1. Create the extension file with the code from the task brief
2. Test that the extension loads without TypeScript errors: `pi -e ~/.pi/agent/extensions/windows-notifier.ts -p "hello"`
3. Commit the file

## Report

Write your report to: `C:/GitLocal/pi-utilities/.superpowers/sdd/task-1-report.md`

Include:
- Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, or BLOCKED
- Files created/modified
- Test results
- Any concerns
