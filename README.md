# STM32 一键编译烧录（stm32-flash-button）

VS Code **状态栏左侧**的「🚀 编译并烧录」按钮：自动探测 STM32 工具链与本工作区固件，
在集成终端一键完成 **编译 → 烧录 → 复位运行**。

## ⚠️ 重要说明：这是官方扩展的「补充」

本插件**不是独立工具**，而是建立在 **ST 官方 STM32CubeIDE for VS Code 扩展套件**之上的补充：
它不自己下载工具链，而是**直接复用官方扩展随附的工具链**（见下面前置依赖）。

> 使用前请先安装 ST 官方扩展套件（VS Code 扩展市场搜 `stm32cube` / `STM32CubeIDE`，
> 或安装 `STM32CubeIDE` 扩展并让其自动准备工具），本插件才能自动找到 cmake / ninja /
> gcc / 烧录器。**不安装官方扩展时，需自行安装工具链并手动配置（见下文）。**

## 前置依赖（工具链）

| 工具 | 作用 | 由谁提供 |
|---|---|---|
| **STM32CubeIDE for VS Code 扩展** | 随附 `cube` 运行时与工具 bundles | ST 官方扩展（推荐） |
| **cmake** | CMake 构建系统 | 官方 bundles / 自装 |
| **ninja** | 构建生成器 | 官方 bundles / 自装 |
| **arm-none-eabi-gcc** | ARM 交叉编译器 | 官方 bundles / 自装 |
| **STM32CubeProgrammer (CLI)** | 烧录器（`STM32_Programmer_CLI`） | 官方 bundles / 自装 |

> 装了官方扩展后，这些工具通常位于 `%LOCALAPPDATA%\stm32cube\bundles\`（Windows）；
> macOS / Linux 的常见位置插件也会自动探测，会递归查找并优先选最新版本。
> 没装官方扩展时，请把上述工具加入系统 `PATH`，或用下面的设置手动指定。

## 特性
- 自动保存未保存的更改：点按钮时先保存全部脏文件，再编译 → 烧录，避免烧到旧代码
- 自动探测工具链：用户设置 → 系统 `PATH` → ST 工具 bundles
- 自动识别固件：扫描工作区 `**/build/**/*.elf`
- 自动增量编译：检测到 `build.ninja` 即先编译再烧录（编译失败则不会烧录）
- 结果 / 报错输出到集成终端「STM32 编译烧录」，可直接复制给 AI / 人工分析

## 安装

**Windows（PowerShell，一键）：**
```powershell
iwr "https://github.com/Conductance-lab/stm32-flash-button/releases/latest/download/stm32-flash-button.vsix" -OutFile "$env:TEMP\stm32-flash-button.vsix"; code --install-extension "$env:TEMP\stm32-flash-button.vsix"
```

**macOS / Linux：**
```bash
curl -L -o /tmp/stm32-flash-button.vsix "https://github.com/Conductance-lab/stm32-flash-button/releases/latest/download/stm32-flash-button.vsix"
code --install-extension /tmp/stm32-flash-button.vsix
```

也可从本仓库 **Releases** 手动下载 `stm32-flash-button.vsix`，或在 VS Code 扩展面板 → `...` → 从 VSIX 安装。
> VSIX 安装的插件不会自动更新，重新执行一次上面的命令即可覆盖升级。

## 使用
1. 先安装 ST 官方扩展并打开 STM32 CMake 工程（含 `CMakeLists.txt`，且/或含任意 `*.ioc` / `CMakePresets.json`）
2. 点状态栏 **🚀 编译并烧录**，或命令面板 `STM32: 一键编译并烧录`
   > 点击后会**先自动保存所有未保存的更改**，再执行编译与烧录；若某个文件保存失败（只读 / 被占用），会中止本次编译烧录并提示。
3. 结果/报错输出在终端「STM32 编译烧录」；自检用 `STM32: 终端自检(工具识别)`

## 手动指定工具路径（可选）
工具未被自动识别时，插件会弹窗并打开 `settings.json`，可配置：
```jsonc
{
  "stm32flash.toolchainDirs": [
    "C:/工具/cmake/bin",
    "C:/工具/ninja/bin",
    "C:/工具/gnu-tools-for-stm32/版本/bin"
  ],
  "stm32flash.programmer": "C:/工具/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe"
}
```
配置后重新点击按钮即可。

## 常见问题
- 未识别到工具 → 先确认已装 ST 官方扩展，或手动配置上面设置；自检用 `STM32: 终端自检(工具识别)`
- 同一工具存在多个版本 → 插件会自动选版本号最高的那个
- macOS / Linux 未识别到工具 → 官方工具包位置较分散，建议在设置里手动指定路径
- 插件不自动更新 → 重新执行安装命令即可覆盖升级
- 烧录 `Unable to get core ID` → 板子独立供电 / SWD 接线共地 / 或 CubeMX 的 SYS→Debug 设成了 `No Debug`（会关闭 SWD），此时把 BOOT0 拨到 1 可恢复连接

