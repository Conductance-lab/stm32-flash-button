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
- **自动注入工具链 PATH（v1.0.0 关键修复）**：构建前把 `arm-none-eabi-gcc` / ninja / cmake 所在目录前置到 `PATH`。
  很多 CMake 工程模板把 `CMAKE_OBJCOPY` / `CMAKE_SIZE` 写成**裸文件名**（`arm-none-eabi-objcopy` / `arm-none-eabi-size`），
  CMake 不会把它们解析成绝对路径 —— 构建期必须能从 `PATH` 找到，否则 `POST_BUILD` 直接报
  `'arm-none-eabi-objcopy' 不是内部或外部命令` → 整个构建失败 → 后面的烧录也不会执行。
- 自动保存未保存的更改：点按钮时先保存全部脏文件，再编译 → 烧录，避免烧到旧代码
- 自动探测工具链：用户设置 → 系统 `PATH` → ST 工具 bundles
- **构建目录与固件严格成对**：`build/Debug` 与 `build/Release` 同时存在时不会「编 Debug、烧 Release」；
  多个候选会弹选择框，并把选择记到 `stm32flash.buildDir`
- **明确的结果反馈**：命令末尾输出 `[STM32-RESULT] OK / FAIL` 哨兵；VS Code 1.93+ 还能读到真实退出码，
  **失败时自动从几百行日志里提取关键报错行**（`FAILED` / `multiple definition` / `undefined reference` / `error:` …）
  并弹窗，可一键复制贴给 AI
- **终端中文不乱码**：每个终端首次使用前先 `chcp 65001`，且发生在打印任何中文之前（首点不再满屏乱码）
- **提示文案不触发 cmd 转义**：不会再出现 `工具链 bin^(将被前置到 PATH^)` 这种看着像报错的回显
- 自动增量编译：找到构建目录即先编译再烧录（编译失败则不会烧录）
- 复用同一个终端（不再每次清空重建），保留历史输出，可直接复制给 AI / 人工分析
- 自检命令会校验 `objcopy` / `size` 是否存在，提前暴露「找不到构建期伴随程序」这类问题
- **文件日志 + 错误兜底**：每一步都写进 `%TEMP%\stm32-flash-button.log`；任何异常都会同时进日志、
  终端（`[STM32-ERROR] 插件内部错误: …`）和弹窗，不会再出现「终端打了几行就没下文」的无声卡住。
  命令面板执行 `STM32: 打开插件日志` 可直接查看。

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
   > 命令末尾会打印 `[STM32-RESULT] OK`（成功）或 `[STM32-RESULT] FAIL`（失败），便于快速判断
4. 构建目录有多个（`build/Debug`、`build/Release`）时会弹选择框，选一次即记住；
   要改选用命令面板的 `STM32: 选择构建目录`

## settings.json 配置项（全部可选）
```jsonc
{
  // 工具所在目录（自动探测不到时填）
  "stm32flash.toolchainDirs": [
    "C:/工具/cmake/bin",
    "C:/工具/ninja/bin",
    "C:/工具/gnu-tools-for-stm32/版本/bin"
  ],
  // 额外前置到 PATH 的目录（构建期 objcopy / size 找不到时，把工具链 bin 填这里）
  "stm32flash.extraPathDirs": ["C:/工具/gnu-tools-for-stm32/版本/bin"],
  // 烧录器绝对路径
  "stm32flash.programmer": "C:/工具/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe",
  // 记住的构建目录（相对工作区，插件选择后会自动写入）
  "stm32flash.buildDir": "build/Debug",
  // 烧录参数，{elf} 会替换成固件绝对路径
  "stm32flash.programmerArgs": "-c port=SWD -w \"{elf}\" -v -rst",
  // 只编译不烧录（板子不在手边时验证工程）
  "stm32flash.buildOnly": false,
  // 点按钮时先清屏（默认 false，保留历史输出）
  "stm32flash.clearBeforeRun": false
}
```
工具未被自动识别时，插件会弹窗并打开 `settings.json`，改完重新点击按钮即可。

## 常见问题
- **构建报 `'arm-none-eabi-objcopy' 不是内部或外部命令` / `FAILED` 停在 POST_BUILD**
  → 构建期找不到 `objcopy` / `size`。插件默认会把 gcc 所在目录前置到 `PATH`，若你的工具链布局特殊，
  把该工具链的 `bin` 目录填到 `stm32flash.extraPathDirs`，再用 `STM32: 终端自检(工具识别)` 确认输出
  `构建期伴随程序: objcopy=OK  size=OK`
- **点了按钮但只编译没烧录** → 看终端是否有 `[STM32-RESULT] OK`；若构建目录里没有 `.elf`，
  或 `CMakeCache.txt` 缺失导致无法推断固件路径，会退化为只编译（终端里有 `[STM32-WARN]` 提示）
- 未识别到工具 → 先确认已装 ST 官方扩展，或手动配置上面设置；自检用 `STM32: 终端自检(工具识别)`
- 同一工具存在多个版本 → 插件会自动选版本号最高的那个
- 不想在终端里打断上一条命令 → 插件检测到终端忙时会先询问是否继续
- macOS / Linux 未识别到工具 → 官方工具包位置较分散，建议在设置里手动指定路径
- 插件不自动更新 → 重新执行安装命令即可覆盖升级
- 烧录 `Unable to get core ID` → 板子独立供电 / SWD 接线共地 / 或 CubeMX 的 SYS→Debug 设成了 `No Debug`（会关闭 SWD），此时把 BOOT0 拨到 1 可恢复连接

## 变更记录

### v1.0.0（重写）
- **[根因修复]** 构建前把工具链目录注入 `PATH`（终端 `env` + 命令内联 `set`/`export` 双保险），
  修复「CMake 模板把 `CMAKE_OBJCOPY` / `CMAKE_SIZE` 写成裸文件名 → POST_BUILD 找不到 `arm-none-eabi-objcopy` →
  构建失败 → 因 `&&` 串联导致烧录永不执行」
- **[逻辑修复]** 构建目录与 `.elf` 严格成对取自同一目录（原来分别取第一个命中，会编 Debug 烧 Release）
- **[逻辑修复]** 编译失败时明确报错并提示自检，不再无脑弹「已在终端执行」
- **[稳健性]** 自己递归扫描工程，不再受 `files.exclude` / `search.exclude` 影响
- **[稳健性]** 复用终端保留历史输出；命令末尾输出 `[STM32-RESULT] OK/FAIL` 哨兵；
  VS Code 1.93+ 通过 shell integration 读取退出码**与输出**，失败时提取关键报错行并支持一键复制
- **[观感修复]** 终端首次使用前先 `chcp 65001`（此前 `chcp` 在末尾，首点中文全乱码）；
  提示文案剔除 `()` `=>` 等会被 cmd 转义成 `^( )` `=^>` 的字符
- **[增强]** 自检命令新增 `objcopy` / `size` 校验、待注入 `PATH` 目录列表、构建目录候选列表
- **[可诊断]** 新增文件日志 `%TEMP%\stm32-flash-button.log`（每步耗时、工具、候选目录、最终命令、异常堆栈），
  异常同时打进终端与日志（不再只弹窗），新增命令 `STM32: 打开插件日志`
- **[根因修复]** 工作区路径改从 `fsPath` → `uri.fsPath` → `uri.path` 逐级兜底解析。
  某些环境（虚拟工作区/远程）下 `WorkspaceFolder.fsPath` 为 `undefined`，旧版直接 `path.resolve(undefined)`
  抛异常并被吞成「未找到 CMake 构建目录，请先配置工程」；现已兼容
- **[新增]** `stm32flash.extraPathDirs` / `buildDir` / `programmerArgs` / `buildOnly` / `clearBeforeRun` 设置项，
  以及命令 `STM32: 选择构建目录`

