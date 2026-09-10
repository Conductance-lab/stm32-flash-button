// STM32 一键编译并烧录 v1.0.0 —— 终端输出版
// 点击状态栏按钮 → 在 VS Code 集成终端「STM32 编译烧录」里执行真实命令；
// 工具未识别 / 执行报错都以清晰文本输出到该终端，便于人 / AI 提取、复现与迭代修复。
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const TERM_NAME = 'STM32 编译烧录';

/* ================= 工具探测 ================= */
// 各平台 ST 工具 bundles 常见位置（Windows / macOS / Linux，目录名常带版本号）
function bundlesRoots() {
    const r = [];
    const home = os.homedir();
    if (process.env.LOCALAPPDATA) r.push(path.join(process.env.LOCALAPPDATA, 'stm32cube', 'bundles'));
    r.push(path.join(home, 'AppData', 'Local', 'stm32cube', 'bundles'));          // Windows 兜底
    r.push(path.join(home, '.stm32cube', 'bundles'));                             // Linux/通用
    r.push(path.join(home, '.local', 'share', 'stm32cube', 'bundles'));           // Linux XDG
    r.push(path.join(home, 'Library', 'Application Support', 'stm32cube', 'bundles')); // macOS
    r.push(path.join(home, 'Library', 'stm32cube', 'bundles'));                   // macOS 备选
    r.push('/Applications/STM32CubeIDE.app/Contents/Eclipse/bundles');            // macOS CubeIDE
    r.push('/opt/st/stm32cubeide/bundles');                                      // Linux CubeIDE
    try {
        for (const e of fs.readdirSync('/opt/st', { withFileTypes: true })) {
            if (e.isDirectory() && e.name.indexOf('stm32cubeide') === 0)
                r.push(path.join('/opt/st', e.name, 'bundles'));                 // 带版本号目录
        }
    } catch (_) { }
    return [...new Set(r)];
}
function existsInPath(f) {
    for (const d of (process.env.PATH || '').split(path.delimiter)) {
        if (!d) continue;
        try { const p = path.join(d, f); if (fs.existsSync(p)) return p; } catch (_) { }
    }
    return null;
}
// 单次递归收集所有目标文件名（深度 6：兼容 .app / 深层嵌套；一次遍历供四项工具共用）
function collectNames(root, names, depth, out) {
    if (depth < 0 || !root) return;
    let es; try { es = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
    for (const e of es) {
        const p = path.join(root, e.name);
        if (e.isDirectory()) collectNames(p, names, depth - 1, out);
        else if (names.has(e.name)) out.push(p);
    }
}
// 从路径的目录名里提取版本号（如 4.2.3+st.1 / 2.23.0），用于在同名工具的多个版本中选最新的
// 只认形如 “数字.数字[.数字...] [+后缀]” 的目录名，避免把用户名(18298)或 STM32 里的数字误当版本
function versionOf(p) {
    let best = [0];
    for (const seg of String(p).split(/[\\/]/)) {
        const m = seg.match(/^(\d+(?:\.\d+)+)(?:[+\-][0-9A-Za-z._]*)?$/);
        if (!m) continue;
        const arr = m[1].split('.').map(Number);
        if (cmpVersion(arr, best) > 0) best = arr;
    }
    return best;
}
function cmpVersion(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x !== y) return x - y;
    }
    return 0;
}
function newest(paths) {
    return paths.slice().sort((a, b) => cmpVersion(versionOf(b), versionOf(a)))[0] || null;
}
function userDirs() { try { return vscode.workspace.getConfiguration('stm32flash').get('toolchainDirs', []); } catch (_) { return []; } }
function resolveTool(kinds, bundleHits) {
    for (const d of userDirs()) if (d) for (const n of kinds) { try { if (fs.existsSync(path.join(d, n))) return path.join(d, n); } catch (_) { } }
    for (const n of kinds) { const p = existsInPath(n); if (p) return p; }
    return newest((bundleHits || []).filter(p => kinds.indexOf(path.basename(p)) >= 0));
}
function detectTools() {
    const want = {
        cmake: ['cmake' + EXE],
        ninja: ['ninja' + EXE],
        gcc: ['arm-none-eabi-gcc' + EXE],
        programmer: ['STM32_Programmer_CLI' + EXE, 'STM32CubeProgrammer' + EXE],
    };
    const names = new Set();
    for (const k of Object.keys(want)) for (const n of want[k]) names.add(n);
    const hits = [];
    for (const root of bundlesRoots()) { if (fs.existsSync(root)) collectNames(root, names, 6, hits); }
    const out = {};
    for (const k of Object.keys(want)) out[k] = resolveTool(want[k], hits);
    return out;
}

/* ================= 产物 / 构建目录 ================= */
async function findElf() {
    for (const root of vscode.workspace.workspaceFolders || []) {
        let uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/build/**/*.elf'), null, 100);
        if (!uris.length) uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.elf'), '**/{node_modules,.venv,.git}/**', 100);
        if (uris.length) return uris[0].fsPath;
    }
    return null;
}
async function findBuildDir() {
    for (const root of vscode.workspace.workspaceFolders || []) {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/build.ninja'), null, 50);
        if (uris.length) return path.dirname(uris[0].fsPath);
    }
    return null;
}

/* ================= 终端输出 ================= */
// 关键：VS Code 集成终端默认用用户的 shell（可能是 PowerShell，不支持 && 与引号调用）。
// 为保证命令可执行，统一使用我们指定的 shell：Windows = cmd.exe，其它 = /bin/bash。
function shellPath() {
    if (IS_WIN) return process.env.ComSpec || 'cmd.exe';
    return fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';   // 极简 Linux 可能没有 bash
}
function getTerm() {
    const old = vscode.window.terminals.find(x => x.name === TERM_NAME);
    if (old) { try { old.dispose(); } catch (_) { } }
    const t = vscode.window.createTerminal({ name: TERM_NAME, shellPath: shellPath() });
    t.show(true);
    return t;
}
// 提示 / 错误行：按 shell 转义，避免 PowerShell 等解析报错
function termLine(t, s) {
    if (IS_WIN) {
        // 注意：cmd 的 echo 里 % 无法用 ^ 转义，直接换成全角字符，避免提示文本显示异常
        const esc = s.replace(/\^/g, '^^').replace(/%/g, '％').replace(/[&|<>()!]/g, m => '^' + m);
        t.sendText('echo ' + esc, true);
    } else {
        const esc = s.replace(/'/g, `'\''`);
        t.sendText("echo '" + esc + "'", true);
    }
}
function termClear(t) { t.sendText(IS_WIN ? 'cls' : 'clear', true); }
function termCmd(t, s) { t.sendText(s); }   // 真实命令（cmd/bash 均支持 && 与引号路径）

/* ================= 主流程 ================= */
async function flashAndBuild() {
    const wf = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!wf) { vscode.window.showErrorMessage('请先打开 STM32 工程文件夹'); return; }
    const term = getTerm();
    termClear(term);

    // 1) 工具识别
    const tools = detectTools();
    const state = {
        cmake: tools.cmake ? 'OK' : '缺失',
        ninja: tools.ninja ? 'OK' : '缺失',
        gcc: tools.gcc ? 'OK' : '缺失',
        programmer: tools.programmer ? 'OK' : '缺失',
    };
    termLine(term, '[STM32] 工具识别: cmake=' + state.cmake + ' ninja=' + state.ninja +
        ' gcc=' + state.gcc + ' programmer=' + state.programmer);

    const miss = [];
    if (!tools.cmake) miss.push('cmake');
    if (!tools.ninja) miss.push('ninja');
    if (!tools.programmer) miss.push('STM32CubeProgrammer');
    if (miss.length) {
        termLine(term, '[STM32-ERROR] 未识别到工具: ' + miss.join(', '));
        termLine(term, '[STM32-HINT] 解决方式: ① 点下方「打开 settings.json」填写 stm32flash.toolchainDirs / stm32flash.programmer ② 或安装 STM32CubeIDE 扩展(自动提供工具)');
        const pick = await vscode.window.showErrorMessage('未识别到工具: ' + miss.join(', '), '打开 settings.json 配置');
        if (pick === '打开 settings.json 配置') await configureTools();
        return;
    }

    // 2) 编译 + 烧录
    const buildDir = await findBuildDir();
    const elf = await findElf();
    const parts = [];
    if (buildDir) parts.push('"' + tools.cmake.replace(/\\/g, '/') + '" --build "' + buildDir.replace(/\\/g, '/') + '"');
    if (elf) parts.push('"' + tools.programmer.replace(/\\/g, '/') + '" -c port=SWD -w "' + elf.replace(/\\/g, '/') + '" -v -rst');
    else termLine(term, '[STM32-WARN] 未找到 .elf，将只执行编译');

    const joined = parts.join(' && ');
    termCmd(term, joined || 'echo [STM32] 无命令可执行: 未找到构建目录与固件');
    vscode.window.showInformationMessage('已在终端执行，请查看「' + TERM_NAME + '」终端输出');
}

/* 自检：仅打印识别结果到终端 */
async function diagTools() {
    const term = getTerm();
    termClear(term);
    const tools = detectTools();
    termLine(term, '[STM32] 工具识别自检:');
    for (const k of ['cmake', 'ninja', 'gcc', 'programmer']) {
        const p = tools[k];
        termLine(term, '  ' + k + ' => ' + (p ? 'OK: ' + p : '缺失'));
    }
    const elf = await findElf();
    termLine(term, '固件 => ' + (elf ? elf : '未找到 .elf'));
    term.show(true);
}

/* ================= 打开 settings.json 让用户配置 ================= */
async function configureTools() {
    await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    vscode.window.showInformationMessage('请在打开的 settings.json 中配置: "stm32flash.toolchainDirs"（cmake/ninja/gcc 所在目录数组）和/或 "stm32flash.programmer"（烧录器绝对路径）。保存后重新点击按钮。');
}

/* ================= 激活 ================= */
function activate(context) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.LEFT, 100);
    item.text = '$(rocket) 编译并烧录';
    item.tooltip = '在「' + TERM_NAME + '」终端执行编译+烧录';
    item.command = 'stm32.flashAndBuild';
    item.show();

    context.subscriptions.push(item,
        vscode.commands.registerCommand('stm32.flashAndBuild', () => flashAndBuild().catch(e => vscode.window.showErrorMessage('插件内部错误: ' + (e && e.message || e)))),
        vscode.commands.registerCommand('stm32.diag', () => diagTools().catch(e => vscode.window.showErrorMessage('插件内部错误: ' + (e && e.message || e)))),
        vscode.commands.registerCommand('stm32.configureTools', () => configureTools().catch(e => vscode.window.showErrorMessage('插件内部错误: ' + (e && e.message || e))))
    );
}
function deactivate() { }
module.exports = { activate, deactivate };
// 便于命令行/CI 自检（VS Code 运行时不使用）
module.exports._internals = { detectTools, bundlesRoots, resolveTool, versionOf };
