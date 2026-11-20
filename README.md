# Pi extension - pi-status

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that puts a **✔️ green checkmark** in your terminal title when the agent is idle, and a **⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ braille-dot spinner** while it's working — so you can tell at a glance whether pi is done or still thinking.
  
[![Test](https://github.com/AI-Team-26/pi-status/actions/workflows/test.yml/badge.svg)](https://github.com/AI-Team-26/pi-status/actions/workflows/test.yml)

## Snapshots

| Idle | Working |
| ---- | ------- |
| ![Idle state](assets/idle.png) | ![Working state](assets/spinner.png) |

## Title format

The base title is `session - project` (or just `project` without a session name), always prefixed by the agent icon:

| State                       | Title                                   |
| --------------------------- | --------------------------------------- |
| Idle (< 50 % context)       | `π ✔️ session - project`                |
| Idle (50 – 89 % context)    | `π ✔️ [63%] session - project`          |
| Idle (≥ 90 % context)       | `π ✔️ ![95%]! session - project`        |
| Working                     | `π ⠋ session - project`                 |

- The context-usage percentage is shown **only** beside the checkmark — never during the spinner. It's captured once when the idle state is shown, not updated live.
- `< 50 %` → percentage hidden; `50 – 89 %` → `[N%]`; `≥ 90 %` → `![N%]!` (high-usage warning).
- ANSI colours don't work inside terminal-title OSC sequences, so everything is plain text.

## Events

The extension listens to three pi events only:

| Event           | Effect                        |
| --------------- | ----------------------------- |
| `session_start` | shows the idle title          |
| `agent_start`   | starts the spinner            |
| `agent_settled` | stops the spinner, idle title |

### Agent icon

Set the **PI_STATUS_AGENT_ICON** environment variable to customise the leading icon (e.g. an emoji). Defaults to `π`. Note: only single-character values are supported for now.

### Idle icon

Set the **PI_STATUS_IDLE_ICON** environment variable to override the icon shown while pi is idle. Defaults to `✔️`.


## Install

```sh
pi install https://github.com/AI-Team-26/pi-status
```

## Develop

```sh
pnpm install        # syntax intellisense
```

## Test

```sh
pnpm test            # single run
pnpm run test:watch  # watch mode
```


## License

[MIT](LICENSE)
