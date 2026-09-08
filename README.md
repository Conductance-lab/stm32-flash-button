# STM32 一键编译烧录（stm32-flash-button）

VS Code **状态栏左侧**的「🚀 编译并烧录」按钮：自动探测工具链与工作区固件，在集成终端执行编译+烧录。

## 使用
1. 打开 STM32 CMake 工程（含 `CMakeLists.txt`，且/或含任意 `*.ioc` / `CMakePresets.json`）
2. 点状态栏 **🚀 编译并烧录**，或命令面板 `STM32: 一键编译并烧录`
3. 结果/报错输出在终端「STM32 编译烧录」；自检用 `STM32: 终端自检(工具识别)`

## 手动指定工具路径（可选）
VS Code 设置搜 `stm32flash`：`stm32flash.toolchainDirs`、`stm32flash.programmer`

## 安装
```bash
code --install-extension stm32-flash-button-1.0.0.vsix
```
