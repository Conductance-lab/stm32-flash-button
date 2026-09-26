# STM32 One-Click Build & Flash

[简体中文](README.md) | **English**

A **🚀 Build & Flash** button in the VS Code status bar (left side): it auto-detects the STM32 toolchain and the firmware in your workspace, and does **build → flash → reset** in the integrated terminal with one click.

## ⚠️ This is a companion to the official ST extension

This extension is **not** a standalone toolchain. It is built on top of the **official STM32CubeIDE for VS Code extension suite** and **reuses the toolchain shipped with it** (see Requirements below).

> Install the official ST extension first (search `stm32cube` / `STM32CubeIDE` in the VS Code Marketplace, or install `STM32CubeIDE` and let it prepare the tools), otherwise this extension cannot find cmake / ninja / gcc / the programmer.
> **Without the official extension you have to install the toolchain yourself and configure it manually (see below).**

## Requirements (toolchain)

| Tool | Purpose | Provided by |
|---|---|---|
| **STM32CubeIDE for VS Code extension** | ships the `cube` runtime and tool bundles | ST official extension (recommended) |
| **cmake** | CMake build system | official bundles / install yourself |
| **ninja** | build generator | official bundles / install yourself |
| **arm-none-eabi-gcc** | ARM cross compiler | official bundles / install yourself |
| **STM32CubeProgrammer (CLI)** | programmer (`STM32_Programmer_CLI`) | official bundles / install yourself |

> With the official extension installed these tools usually live under `%LOCALAPPDATA%\stm32cube\bundles\` (Windows). Common macOS / Linux locations are probed as well — the extension searches recursively and prefers the newest version.
> Without the official extension, add these tools to your system `PATH`, or configure them manually in the settings below.

## Features
- **Bilingual**: every message follows the VS Code display language (English by default, Simplified Chinese when VS Code runs in Chinese).
- **Keyboard shortcuts**: `Ctrl+Alt+B` build & flash, `Ctrl+Alt+F` flash only (no build). The status bar button is equivalent to the former.
- **Toolchain PATH injection (key v1.0.0 fix)**: before building, the directories of `arm-none-eabi-gcc` / ninja / cmake are prepended to `PATH`.
  Many CMake templates set `CMAKE_OBJCOPY` / `CMAKE_SIZE` to **bare file names** (`arm-none-eabi-objcopy` / `arm-none-eabi-size`) and CMake does not resolve them to absolute paths — they must be found on `PATH` at build time. Otherwise `POST_BUILD` fails with
  `'arm-none-eabi-objcopy' is not recognized as an internal or external command`, the whole build fails and the following flash step never runs.
- **Saves your work first**: all dirty files are saved before building, so you never flash stale code.
- **Toolchain auto-detection**: user settings → system `PATH` → ST tool bundles.
- **Build directory and firmware always come from the same folder**: with both `build/Debug` and `build/Release` present you will never "build Debug and flash Release". When several candidates exist you pick one, and the choice is remembered in `stm32flash.buildDir`.
- **Clear result feedback**: the command ends with a `[STM32-RESULT] OK / FAIL` sentinel; on VS Code 1.93+ the real exit code is read, and on failure the key error lines are extracted from hundreds of log lines
  (`FAILED` / `multiple definition` / `undefined reference` / `error:` …) and shown in a dialog you can copy with one click.
- **No mojibake in the terminal**: `chcp 65001` is issued before any Chinese text is printed (the very first click is clean too).
- **Hint text never triggers cmd escaping**: no more `工具链 bin^(will be prepended to PATH^)`-style echoes that look like errors.
- **Incremental builds**: as soon as a build directory is found it builds before flashing (a failed build is never flashed).
- **Reuses a single terminal** instead of recreating it, so history is preserved and can be copied to an AI / human for analysis.
- The self-check command verifies that `objcopy` / `size` exist, surfacing "missing build-time companion program" problems early.
- **File log + error fallback**: every step is written to `%TEMP%\stm32-flash-button.log`; any exception goes to the log, to the terminal (`[STM32-ERROR] internal error: …`) and to a dialog, so the extension never silently stalls.
  Run `STM32: Open Extension Log` from the Command Palette to inspect it.

## Install

**From the Marketplace (recommended):** search for **STM32 One-Click Build & Flash** in the Extensions view, or run:
```bash
code --install-extension conductance-lab.stm32-oneclick-flash
```

**From VSIX (Windows, PowerShell one-liner):**
```powershell
iwr "https://github.com/Conductance-lab/stm32-flash-button/releases/latest/download/stm32-flash-button.vsix" -OutFile "$env:TEMP\stm32-flash-button.vsix"; code --install-extension "$env:TEMP\stm32-flash-button.vsix"
```

**macOS / Linux:**
```bash
curl -L -o /tmp/stm32-flash-button.vsix "https://github.com/Conductance-lab/stm32-flash-button/releases/latest/download/stm32-flash-button.vsix"
code --install-extension /tmp/stm32-flash-button.vsix
```

You can also download `stm32-flash-button.vsix` from **Releases**, or use Extensions view → `...` → "Install from VSIX...".
> Extensions installed from VSIX do not auto-update; run the command above again to upgrade in place.

## Usage
1. Install the official ST extension and open an STM32 CMake project (containing `CMakeLists.txt` and/or any `*.ioc` / `CMakePresets.json`).
2. Click **🚀 Build & Flash** in the status bar, run `STM32: Build and Flash` from the Command Palette, or use a shortcut:
   > All unsaved changes are **saved first**, then the build and flash run. If a file cannot be saved (read-only / locked), the run is aborted with a message.
   > Shortcuts: `Ctrl+Alt+B` build & flash; `Ctrl+Alt+F` flash only (no build — requires an already-built firmware).
3. Results and errors are printed in the terminal titled "STM32 Build & Flash"; use `STM32: Self Check (tool detection)` for a self-check.
   > The command prints `[STM32-RESULT] OK` (success) or `[STM32-RESULT] FAIL` (failure) at the end.
4. When several build directories exist (`build/Debug`, `build/Release`) a picker appears and your choice is remembered;
   run `STM32: Select Build Directory` to change it.

> On a Chinese VS Code the Command Palette entries are shown with Chinese titles, for example `STM32: 一键编译并烧录`.
> The terminal is titled `STM32 Build & Flash` (Chinese UI: `STM32 编译烧录`) and is reused by name, so its history is preserved.

## settings.json (everything is optional)
```jsonc
{
  // Directories containing the tools (fill in when auto-detection fails)
  "stm32flash.toolchainDirs": [
    "C:/tools/cmake/bin",
    "C:/tools/ninja/bin",
    "C:/tools/gnu-tools-for-stm32/<version>/bin"
  ],
  // Extra directories prepended to PATH (put the toolchain bin here when
  // objcopy / size cannot be found at build time)
  "stm32flash.extraPathDirs": ["C:/tools/gnu-tools-for-stm32/<version>/bin"],
  // Absolute path to the programmer
  "stm32flash.programmer": "C:/tools/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe",
  // Remembered build directory (relative to the workspace, written by the extension)
  "stm32flash.buildDir": "build/Debug",
  // Programmer arguments; {elf} is replaced with the absolute firmware path
  "stm32flash.programmerArgs": "-c port=SWD -w \"{elf}\" -v -rst",
  // Build only, do not flash (useful when the board is not at hand)
  "stm32flash.buildOnly": false,
  // Clear the terminal before each run (default false, keeps history)
  "stm32flash.clearBeforeRun": false
}
```
When the toolchain cannot be detected, the extension shows a dialog and opens `settings.json`; edit it and click the button again.

## FAQ
- **Build fails with `'arm-none-eabi-objcopy' is not recognized...` / `FAILED` at POST_BUILD**
  → `objcopy` / `size` cannot be found at build time. The extension prepends the gcc directory to `PATH` by default; if your toolchain layout is unusual, put its `bin` directory into `stm32flash.extraPathDirs` and confirm with `STM32: Self Check (tool detection)` that it prints
  `build-time companions: objcopy=OK size=OK` (on a Chinese UI: `构建期伴随程序: objcopy=OK  size=OK`).
- **The button built but did not flash** → check whether the terminal shows `[STM32-RESULT] OK`. If the build directory has no `.elf`, or `CMakeCache.txt` is missing so the firmware path cannot be inferred, the run degrades to build-only (with a `[STM32-WARN]` in the terminal).
- **Toolchain not detected** → make sure the official ST extension is installed, or configure the settings above; use `STM32: Self Check (tool detection)` to diagnose.
- **Several versions of the same tool** → the extension automatically picks the highest version.
- **Don't want to interrupt the previous command in the terminal** → when the terminal is busy the extension asks before continuing.
- **macOS / Linux: toolchain not detected** → official tool bundles are scattered; specify the paths manually in the settings.
- **The extension does not auto-update** → run the install command again to upgrade in place.
- **Flashing fails with `Unable to get core ID`** → power the board independently / make sure the SWD wiring shares ground / or check that CubeMX `SYS → Debug` is not set to `No Debug` (that disables SWD). Setting BOOT0 to 1 restores the connection.

## Changelog

### v1.0.5
- **Fixed**: on an English UI the terminal name and the status bar tooltip still leaked Chinese - the terminal name now follows the display language
  (`STM32 Build & Flash` in English, `STM32 编译烧录` in Chinese), so English mode shows no Chinese anywhere in the UI or the terminal.
- Added **STM32 Flash** to the keywords to improve search hits.

### v1.0.4
- **Bilingual**: the UI and all terminal output follow the VS Code display language (English by default, Simplified Chinese on a Chinese VS Code).
  Command Palette titles, setting descriptions, the status bar item and its tooltip, dialogs and terminal messages are all localized.
- Intentionally left untranslated: the `[STM32-RESULT]` / `[STM32-ERROR]` / `[STM32-WARN]` / `[STM32-HINT]` markers (tools and AI rely on them)
  and the Chinese search keywords; the terminal name follows the display language since v1.0.5.

### v1.0.3
- **New shortcuts**: `Ctrl+Alt+B` build & flash, `Ctrl+Alt+F` flash only (no build); on macOS `Cmd+Alt+B` / `Cmd+Alt+F`.
- New command `STM32: Flash Only (No Build)`: skips the build step and no longer requires cmake or `objcopy` / `size`;
  if the build directory has no `.elf` yet it fails with a clear message telling you to use `Ctrl+Alt+B` instead.
- The terminal prints a `[STM32] mode: …` line so you always know whether the run was build + flash, flash only or build only.

### v1.0.2
- Added the extension icon (there was no icon file before, so the Marketplace and the Extensions view fell back to the default placeholder).

### v1.0.1
- **Extension ID changed**: `conductance-lab.stm32-flash-button` → `conductance-lab.stm32-oneclick-flash`,
  with the display name **STM32 One-Click Build & Flash** (the old name is permanently reserved on the Marketplace).
  > ⚠️ The old and the new ID are different extensions: uninstall the old one when upgrading, otherwise you end up with two status bar buttons.

### v1.0.0 (rewrite)
- **[Root cause]** Inject the toolchain directories into `PATH` before building (both via terminal `env` and an inline `set`/`export`), fixing the chain
  "CMake template writes `CMAKE_OBJCOPY` / `CMAKE_SIZE` as bare file names → `POST_BUILD` cannot find `arm-none-eabi-objcopy` → build fails → the `&&` chain means flashing never runs".
- **[Logic]** The build directory and the `.elf` are always taken from the same folder (previously each was the first match, so it could build Debug and flash Release).
- **[Logic]** A failed build now reports clearly instead of always showing "command sent to terminal".
- **[Robustness]** The workspace is scanned by the extension itself, no longer affected by `files.exclude` / `search.exclude`.
- **[Robustness]** A single terminal is reused to keep history; a `[STM32-RESULT] OK/FAIL` sentinel is printed at the end; on VS Code 1.93+ the exit code **and output** are read through shell integration, and key error lines are extracted with a one-click copy action.
- **[Cosmetics]** `chcp 65001` is issued before the first use of the terminal (it used to run last, so the first run was mojibake); hint text no longer contains `()` `=>` characters that cmd escapes into `^( )` `=^>`.
- **[Enhancement]** The self-check now verifies `objcopy` / `size`, lists the directories to be injected into `PATH`, and lists the build directory candidates.
- **[Diagnosability]** New file log `%TEMP%\stm32-flash-button.log` (per-step timings, tools, candidates, final command, exception stack). Exceptions go to both the terminal and the log (no longer dialog-only), plus a new `STM32: Open Extension Log` command.
- **[Root cause]** Workspace path resolution now falls back through `fsPath` → `uri.fsPath` → `uri.path`. In some environments (virtual / remote workspaces) `WorkspaceFolder.fsPath` is `undefined` and the old code threw from `path.resolve(undefined)`, which was swallowed and surfaced as "no CMake build directory found".
- **[Mojibake]** The terminal codepage is switched in stages: UTF-8 (`chcp 65001`) for the Chinese banner, then back to the system ANSI codepage (e.g. 936) for build/flash, because STM32CubeProgrammer writes its progress/status text in GBK and it decoded to `�` under 65001.
- **[New]** Settings `stm32flash.extraPathDirs` / `buildDir` / `programmerArgs` / `buildOnly` / `clearBeforeRun`, and the command `STM32: Select Build Directory`.
