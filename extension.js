// STM32 一键编译并烧录 v1.0.0 —— 终端输出版
// 点击状态栏按钮 → 在 VS Code 集成终端「STM32 编译烧录」里执行真实命令；
// 工具未识别 / 执行报错都以清晰文本输出到该终端，便于人 / AI 提取、复现与迭代修复。
//
// ── v1.0.0 重写（2026-09-14）──────────────────────────────────────────────
//  [根因修复] 构建前把工具链目录注入 PATH。
//      CMake 工程模板（cmake/gcc-arm-none-eabi.cmake）把 CMAKE_OBJCOPY / CMAKE_SIZE 写成
//      **裸文件名**（arm-none-eabi-objcopy / arm-none-eabi-size，注释写着
//      "arm-none-eabi- must be part of path environment"）。CMake 会自动把 CMAKE_C_COMPILER
//      解析成绝对路径，但**不会**解析 OBJCOPY / SIZE —— 它们必须在构建期从 PATH 里找到。
//      只用 bundles 里的裸 cmake.exe 构建时，POST_BUILD 直接报
//          'arm-none-eabi-objcopy' 不是内部或外部命令
//      → ninja FAILED → 命令又是 && 串联 → 烧录步骤永远不执行，
//      表现出来就是「点了按钮没反应 / 程序烧不进去」。用 cube-cmake 不暴露该问题，
//      因为 cube-cmake 会把 bundles/*/bin 注入 PATH。
//  [逻辑修复] 构建目录与 .elf 必须成对取自同一目录。原实现分别取第一个命中，
//      build/Debug 与 build/Release 同时存在时会「编 Debug、烧 Release」，烧错固件。
//  [逻辑修复] 编译失败时明确报错，不再无脑弹「已在终端执行」。
//  [稳健性]  自己递归扫描工程，不再用 workspace.findFiles（会被 files.exclude /
//      search.exclude 影响，一旦排除 build 就静默退化成「只编译不烧录」）。
//  [稳健性]  复用同一个终端（不再 dispose），保留历史输出；命令末尾打印
//      [STM32-RESULT] OK / FAIL 哨兵，并在支持时通过 shell integration 读退出码弹窗。
//  [增强]    自检命令校验 objcopy / size 是否存在（正是本次故障点）；工具探测加缓存。
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';
const TERM_NAME = 'STM32 编译烧录';
const RESULT_MARK = '[STM32-RESULT]';
const DEFAULT_PROG_ARGS = '-c port=SWD -w "{elf}" -v -rst';
const SCAN_DEPTH = 4;                 // 从工作区根向下递归的深度
const SKIP_DIRS = new Set(['.git', '.hg', '.svn', '.vs', '.cache', 'node_modules', '.venv', 'venv', '__pycache__', 'dist']);

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
function config() {
    try { return vscode.workspace.getConfiguration('stm32flash'); }
    catch (_) { return { get: (k, d) => d, update: async () => { } }; }
}
// 用户手填的目录：toolchainDirs（工具所在目录）+ extraPathDirs（只用于注入 PATH 的目录）
function userDirs() {
    const out = [];
    for (const k of ['toolchainDirs', 'extraPathDirs']) {
        const v = config().get(k, []);
        if (Array.isArray(v)) for (const d of v) if (d) out.push(d);
    }
    return [...new Set(out)];
}
function resolveTool(kinds, bundleHits) {
    for (const d of userDirs()) for (const n of kinds) { try { if (fs.existsSync(path.join(d, n))) return path.join(d, n); } catch (_) { } }
    for (const n of kinds) { const p = existsInPath(n); if (p) return p; }
    return newest((bundleHits || []).filter(p => kinds.indexOf(path.basename(p)) >= 0));
}
// 探测结果缓存（递归扫 bundles 树约百毫秒级）；60 秒过期，装了新工具不必重载窗口
let _toolCache = null, _toolCacheAt = 0;
const TOOL_CACHE_MS = 60 * 1000;
function detectTools(force) {
    if (!force && _toolCache && (Date.now() - _toolCacheAt) < TOOL_CACHE_MS) return _toolCache;
    const want = {
        cmake: ['cmake' + EXE],
        ninja: ['ninja' + EXE],
        gcc: ['arm-none-eabi-gcc' + EXE],
        programmer: ['STM32_Programmer_CLI' + EXE, 'STM32CubeProgrammer' + EXE],
    };
    const names = new Set();
    for (const k of Object.keys(want)) for (const n of want[k]) names.add(n);
    const hits = [];
    for (const root of bundlesRoots()) { try { if (fs.existsSync(root)) collectNames(root, names, 6, hits); } catch (_) { } }
    const out = {};
    for (const k of Object.keys(want)) out[k] = resolveTool(want[k], hits);
    _toolCache = out;
    _toolCacheAt = Date.now();
    return out;
}

/* ========= 工具链伴随程序（本次故障的关键点） ========= */
// 这些程序在构建期被「裸文件名」调用，必须能从 PATH 找到；它们和 gcc 同目录。
const companionNames = () => ['arm-none-eabi-objcopy' + EXE, 'arm-none-eabi-size' + EXE];
function toolchainDirOf(f) { try { return f ? path.dirname(f) : null; } catch (_) { return null; } }
// 需要注入 PATH 的目录：用户手填优先 → gcc 目录（objcopy/size 在这里，最关键）→ ninja → cmake
function toolchainPathDirs(tools) {
    const dirs = [
        ...userDirs(),
        toolchainDirOf(tools && tools.gcc),
        toolchainDirOf(tools && tools.ninja),
        toolchainDirOf(tools && tools.cmake),
    ].filter(Boolean);
    return [...new Set(dirs)];
}
// 检查 objcopy / size 到底在哪：找不到就在这里直接报出来，而不是等构建时炸
function checkCompanions(tools) {
    const dirs = toolchainPathDirs(tools);
    const found = {}, missing = [];
    for (const n of companionNames()) {
        let p = null;
        for (const d of dirs) { try { const q = path.join(d, n); if (fs.existsSync(q)) { p = q; break; } } catch (_) { } }
        if (!p) p = existsInPath(n);
        if (p) found[n] = p; else missing.push(n);
    }
    return { found, missing, dirs };
}
// PATH 的键名：Windows 上通常是 `Path`，沿用原键名，避免出现两个 PATH 变量
function pathKey() {
    if (!IS_WIN) return 'PATH';
    for (const k of Object.keys(process.env)) if (k.toLowerCase() === 'path') return k;
    return 'PATH';
}
// 创建终端时先注入 PATH（复用终端时 env 不会更新，所以命令里还会再设一次，双保险）
function envWithPath(dirs) {
    if (!dirs || !dirs.length) return {};
    const key = pathKey();
    const cur = process.env[key] || '';
    return { [key]: dirs.join(path.delimiter) + (cur ? path.delimiter + cur : '') };
}
// 命令里内联的 PATH 设置片段
function pathPrefix(dirs) {
    if (!dirs || !dirs.length) return '';
    return IS_WIN
        ? 'set "PATH=' + dirs.join(';') + ';%PATH%"'
        : 'export PATH="' + dirs.join(':') + ':$PATH"';
}
function okMark(p) { return p ? 'OK' : '缺失'; }

/* ================= 工程扫描：构建目录 ⇄ 固件 严格成对 ================= */
// 自己递归扫描，不用 workspace.findFiles —— 后者受 files.exclude / search.exclude 影响，
// 一旦用户把 build 排除掉就会静默找不到 .elf，退化成「只编译不烧录」。
function listDirs(root, maxDepth) {
    const out = [];
    (function rec(dir, depth) {
        if (depth > maxDepth) return;
        let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        for (const e of es) {
            if (!e.isDirectory() || e.isSymbolicLink()) continue;   // 跳过符号链接，避免目录环
            if (SKIP_DIRS.has(e.name)) continue;
            const p = path.join(dir, e.name);
            out.push(p);
            rec(p, depth + 1);
        }
    })(root, 1);
    return out;
}
// 在构建目录内找 .elf（最多向下 2 层，兼容多配置生成器），取最新修改的那个
function findElfIn(dir, depth) {
    let best = null;
    (function rec(d, k) {
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const e of es) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { if (k > 0 && !SKIP_DIRS.has(e.name)) rec(p, k - 1); }
            else if (/\.elf$/i.test(e.name)) {
                let ms = 0; try { ms = fs.statSync(p).mtimeMs; } catch (_) { }
                if (!best || ms > best.ms) best = { p, ms };
            }
        }
    })(dir, depth);
    return best ? best.p : null;
}
function readCacheVar(buildDir, name) {
    try {
        const txt = fs.readFileSync(path.join(buildDir, 'CMakeCache.txt'), 'utf8');
        const m = txt.match(new RegExp('^' + name + ':[^=\\r\\n]*=(.*)$', 'm'));
        return m ? m[1].trim() : null;
    } catch (_) { return null; }
}
// 还没构建过时预测 .elf 路径（读 CMakeCache 的 CMAKE_PROJECT_NAME），
// 这样「首次构建 + 烧录」也能一次点完
function predictElf(buildDir) {
    const name = readCacheVar(buildDir, 'CMAKE_PROJECT_NAME');
    return name ? path.join(buildDir, name + '.elf') : null;
}
// 扫描所有候选构建目录；每个候选自带「同一目录下」的固件
function scanTargets(root) {
    const list = [], seen = new Set();
    for (const d of [root, ...listDirs(root, SCAN_DEPTH)]) {
        const rp = path.resolve(d);
        if (seen.has(rp)) continue;
        let isBuild = false;
        try {
            isBuild = fs.existsSync(path.join(d, 'build.ninja'))
                || fs.existsSync(path.join(d, 'CMakeCache.txt'))
                || fs.existsSync(path.join(d, 'Makefile'));
        } catch (_) { }
        if (!isBuild) continue;
        seen.add(rp);
        let elf = findElfIn(d, 2);
        if (!elf) elf = predictElf(d);
        const hasElf = !!elf && fs.existsSync(elf);
        let ms = 0;
        if (hasElf) { try { ms = fs.statSync(elf).mtimeMs; } catch (_) { } }
        else { try { ms = fs.statSync(path.join(d, 'CMakeCache.txt')).mtimeMs; } catch (_) { } }
        list.push({ buildDir: d, elf, hasElf, mtime: ms });
    }
    // 有真实固件的排前面，其次按时间新的排前面
    list.sort((a, b) => (b.hasElf ? 1 : 0) - (a.hasElf ? 1 : 0) || b.mtime - a.mtime);
    return list;
}
function wsRoot() {
    const f = vscode.workspace.workspaceFolders;
    return f && f.length ? f[0] : null;
}
function relLabel(rootPath, p) {
    try {
        const r = path.relative(rootPath, p);
        return r && r.indexOf('..') !== 0 ? r.replace(/\\/g, '/') : p;
    } catch (_) { return p; }
}
// 选构建目录：设置里记住的 → 唯一候选 → 弹 QuickPick 让用户选（并把选择记到 stm32flash.buildDir）
async function pickTarget(rootPath, cands, term, forceAsk) {
    if (!cands.length) return null;
    const remembered = forceAsk ? '' : (config().get('buildDir', '') || '');
    if (remembered) {
        const want = path.resolve(rootPath, remembered);
        const hit = cands.find(c => path.resolve(c.buildDir) === want);
        if (hit) return hit;
    }
    if (cands.length === 1 && !forceAsk) return cands[0];

    const items = cands.map(c => ({
        label: relLabel(rootPath, c.buildDir),
        description: c.hasElf ? '固件 ' + path.basename(c.elf) : '（尚未构建，固件待生成）',
        detail: new Date(c.mtime).toLocaleString(),
        _c: c,
    }));
    const pick = await vscode.window.showQuickPick(items, {
        title: '选择要编译并烧录的构建目录',
        placeHolder: 'Debug / Release 同时存在时必须选一个（选择会记入 stm32flash.buildDir）',
        ignoreFocusOut: true,
    });
    if (!pick) { if (term) termLine(term, '[STM32-WARN] 未选择构建目录，已取消本次操作'); return null; }
    const rel = relLabel(rootPath, pick._c.buildDir);
    try { await config().update('buildDir', rel, vscode.ConfigurationTarget.Workspace); } catch (_) { }
    if (term) termLine(term, '[STM32] 已记住构建目录: ' + rel + '（要改选请执行命令「STM32: 选择构建目录」）');
    return pick._c;
}

/* ================= 终端输出 ================= */
// 关键：VS Code 集成终端默认用用户的 shell（可能是 PowerShell，不支持 && 与引号调用）。
// 为保证命令可执行，统一使用我们指定的 shell：Windows = cmd.exe，其它 = /bin/bash。
function shellPath() {
    if (IS_WIN) return process.env.ComSpec || 'cmd.exe';
    return fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';   // 极简 Linux 可能没有 bash
}
// 终端是否正在执行上一条命令（需要 shell integration，不支持时一律返回 false）
function termBusy(t) {
    try {
        const si = t.shellIntegration;
        return !!(si && si.execution && si.execution.isRunning);
    } catch (_) { return false; }
}
// cmd 默认代码页是 936，直接 echo 中文就是乱码 —— 每个终端第一次使用前先切到 UTF-8，
// 而且必须发生在打印任何中文之前（否则首次点按钮整屏提示全是乱码，看着像"识别不了"）。
const _cpReady = new WeakSet();
function ensureUtf8(t) {
    if (!IS_WIN || _cpReady.has(t) || termBusy(t)) return;   // 终端忙时别往它的 stdin 里塞东西
    _cpReady.add(t);
    t.sendText('chcp 65001 >nul 2>nul', true);
}
// 复用同一个终端（不再 dispose）：保留上一次的输出，便于回看 / 复制给 AI 分析。
// 创建时先把工具链目录注入 PATH；复用终端时 env 无法更新，所以命令里还会再设一次。
function getTerm(dirs, clear) {
    let t = vscode.window.terminals.find(x => x.name === TERM_NAME && !x.exitStatus);
    if (t) {
        const co = t.creationOptions || {};
        const cur = co.shellPath ? path.basename(String(co.shellPath)).toLowerCase() : '';
        if (cur && cur !== path.basename(shellPath()).toLowerCase()) {
            try { t.dispose(); } catch (_) { }    // 只有 shell 变了（用户改过设置）才重建
            t = null;
        }
    }
    if (!t) t = vscode.window.createTerminal({ name: TERM_NAME, shellPath: shellPath(), env: envWithPath(dirs) });
    t.show(true);
    if (clear) termClear(t);
    ensureUtf8(t);
    return t;
}
// 提示行里不要出现 ( ) ! = > 等字符：cmd 回显命令时会显示成 ^( ^) ^! 等转义符，看着像报错。
// termLine 仍保留转义以防万一，但文案层面已经避开。
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
// 从构建/烧录输出里挑出真正的关键报错行，免得淹在几百行编译日志里
function extractErrors(text) {
    const pat = /(FAILED|error:|Error:|undefined reference|multiple definition|fatal error|ninja: build stopped|No such file|not found|cannot find|Unable to|no such file)/;
    const out = [], seen = new Set();
    for (let l of String(text || '').split(/\r?\n/)) {
        l = l.trim();
        if (!l || !pat.test(l)) continue;
        if (l.length > 220) l = l.slice(0, 220) + ' …';
        if (seen.has(l)) continue;
        seen.add(l); out.push(l);
        if (out.length >= 8) break;
    }
    return out;
}
// 若 VS Code 支持 shell integration（1.93+），读取真实退出码 + 输出，
// 失败时把关键报错行提取出来弹窗（可一键复制给 AI），不用再让人在终端里大海捞针。
// 不支持时也不影响：终端里还有 [STM32-RESULT] OK/FAIL 哨兵行。
function watchResult(t) {
    const onEnd = vscode.window.onDidEndTerminalShellExecution;
    if (typeof onEnd !== 'function') return;
    let sub = null;
    const giveUp = setTimeout(() => { try { if (sub) sub.dispose(); } catch (_) { } }, 10 * 60 * 1000);
    sub = onEnd(async e => {
        try {
            if (e.terminal !== t) return;
            const line = (e.execution && e.execution.commandLine && e.execution.commandLine.value) || '';
            if (line.indexOf(RESULT_MARK) < 0) return;     // 只认我们那条链式命令
            const code = e.execution.exitCode;
            if (typeof code !== 'number') return;
            clearTimeout(giveUp);
            try { sub.dispose(); } catch (_) { }

            let out = '';
            try {
                if (typeof e.execution.read === 'function') {
                    for await (const chunk of e.execution.read()) out += chunk;
                }
            } catch (_) { }

            if (code === 0) {
                vscode.window.showInformationMessage('STM32: 编译并烧录完成 ✅');
                return;
            }
            const errs = extractErrors(out);
            const items = errs.length ? ['复制关键报错', '查看终端'] : ['查看终端'];
            const pick = await vscode.window.showErrorMessage(
                'STM32: 编译或烧录失败，退出码 ' + code + '，已提取 ' + errs.length + ' 行关键报错',
                ...items);
            if (pick === '复制关键报错') {
                try {
                    await vscode.env.clipboard.writeText(errs.join('\n'));
                    vscode.window.showInformationMessage('STM32: 关键报错已复制到剪贴板，可直接贴给 AI 分析');
                } catch (_) { }
            }
        } catch (_) { }
    });
}

/* ================= 保存未保存的更改 ================= */
// 编译/烧录前先把编辑器里所有未保存的更改写盘，避免构建用的是磁盘上的旧代码
// 返回 true = 已全部保存（或本来就没有脏文件）；false = 有文件保存失败，应中止流程
async function saveAllBeforeBuild(term) {
    const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty);
    if (!dirty.length) { termLine(term, '[STM32] 保存检查: 没有未保存的更改'); return true; }

    const onDisk = dirty.filter(d => d.uri.scheme === 'file');
    const untitled = dirty.filter(d => d.uri.scheme !== 'file');
    for (const d of onDisk) { try { await d.save(); } catch (_) { } }

    // 复核：仍为脏的文件即为保存失败（如只读 / 被占用 / 有冲突）
    const failed = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.scheme === 'file');
    if (failed.length) {
        const names = failed.map(d => path.basename(d.fileName || d.uri.path)).join(', ');
        termLine(term, '[STM32-ERROR] 保存失败，已中止编译烧录: ' + names);
        termLine(term, '[STM32-HINT] 请手动按 Ctrl+S 保存这些文件后重试；若提示只读或被占用，请检查文件权限或关闭占用程序');
        vscode.window.showErrorMessage('有文件未能保存，已中止编译烧录: ' + names);
        return false;
    }
    termLine(term, '[STM32] 保存检查: 已保存 ' + onDisk.length + ' 个文件');
    if (untitled.length) {
        termLine(term, '[STM32-WARN] 存在未保存到磁盘的临时文件【untitled】，其内容不会参与编译: ' +
            untitled.map(d => d.uri.path || d.fileName || 'untitled').join(', '));
    }
    return true;
}

/* ================= 主流程 ================= */
let _lastInvoke = 0;
async function flashAndBuild() {
    const root = wsRoot();
    if (!root) { vscode.window.showErrorMessage('请先打开 STM32 工程文件夹'); return; }
    if (Date.now() - _lastInvoke < 800) return;           // 防连点
    _lastInvoke = Date.now();

    const cfg = config();
    const tools = detectTools();
    const dirs = toolchainPathDirs(tools);
    const term = getTerm(dirs, !!cfg.get('clearBeforeRun', false));
    if (termBusy(term)) {
        const go = await vscode.window.showWarningMessage('终端「' + TERM_NAME + '」正在执行上一条命令，继续会打断它。是否继续？', '继续', '取消');
        if (go !== '继续') return;
    }

    // 1) 先保存所有未保存的更改，确保编译/烧录的是最新代码
    if (!await saveAllBeforeBuild(term)) return;

    // 2) 工具识别
    termLine(term, '[STM32] 工具识别: cmake=' + okMark(tools.cmake) + ' ninja=' + okMark(tools.ninja) +
        ' gcc=' + okMark(tools.gcc) + ' programmer=' + okMark(tools.programmer));
    if (tools.gcc) termLine(term, '[STM32] 工具链 bin 待前置到 PATH: ' + toolchainDirOf(tools.gcc));

    // ★ 关键检查：objcopy / size 是构建期被「裸文件名」调用的，找不到就一定构建失败
    const comp = checkCompanions(tools);
    if (comp.missing.length) {
        termLine(term, '[STM32-ERROR] 找不到构建期伴随程序: ' + comp.missing.join(', '));
        termLine(term, '[STM32-HINT] 原因: CMake 工程模板把 CMAKE_OBJCOPY/CMAKE_SIZE 写成裸文件名，构建时必须能从 PATH 找到它们；否则 POST_BUILD 直接 FAILED，后面的烧录也不会执行');
        termLine(term, '[STM32-HINT] 解决: ① 确认 arm-none-eabi-gcc 与 objcopy/size 在同一 bin 目录 ② 用 stm32flash.extraPathDirs 填该目录 ③ 用 stm32flash.toolchainDirs 手动指定');
    }

    const miss = [];
    if (!tools.cmake) miss.push('cmake');
    if (!cfg.get('buildOnly', false) && !tools.programmer) miss.push('STM32CubeProgrammer CLI');
    if (miss.length) {
        termLine(term, '[STM32-ERROR] 未识别到工具: ' + miss.join(', '));
        termLine(term, '[STM32-HINT] 解决方式: ① 点下方「打开 settings.json」填写 stm32flash.toolchainDirs / stm32flash.programmer ② 或安装 STM32CubeIDE 扩展，它会自带工具链');
        const pick = await vscode.window.showErrorMessage('未识别到工具: ' + miss.join(', '), '打开 settings.json 配置');
        if (pick === '打开 settings.json 配置') await configureTools();
        return;
    }

    // 3) 选构建目录（构建目录与其 .elf 一定取自同一目录，避免「编 Debug、烧 Release」）
    const cands = scanTargets(root.fsPath);
    if (!cands.length) {
        termLine(term, '[STM32-ERROR] 未找到任何 CMake 构建目录，需含 build.ninja 或 CMakeCache.txt 或 Makefile');
        termLine(term, '[STM32-HINT] 请先用 STM32Cube 扩展或 cube-cmake --preset Debug 配置一次工程，再点本按钮');
        vscode.window.showErrorMessage('未找到 CMake 构建目录，请先配置工程');
        return;
    }
    termLine(term, '[STM32] 构建目录候选 ' + cands.length + ' 个: ' + cands.map(c => relLabel(root.fsPath, c.buildDir)).join(' / '));
    const tgt = await pickTarget(root.fsPath, cands, term, false);
    if (!tgt) return;

    // 4) 拼命令: PATH 注入 → 编译 → 烧录 → 结果哨兵
    const buildOnly = !!cfg.get('buildOnly', false);
    if (!buildOnly) {
        if (tgt.elf && !tgt.hasElf) termLine(term, '[STM32] 该目录尚无固件，本次先编译再烧录，预期固件: ' + tgt.elf);
        if (!tgt.elf) termLine(term, '[STM32-WARN] 无法确定固件路径【缺少 CMakeCache】，本次只编译不烧录');
    }
    const cmd = commandLine(tools, tgt, dirs, buildOnly, String(cfg.get('programmerArgs', DEFAULT_PROG_ARGS) || ''));

    termLine(term, '[STM32] 平台 ' + process.platform + ' / shell ' + path.basename(shellPath()) +
        ' / PATH 注入 ' + (dirs.length ? dirs.length + ' 个目录' : '无'));
    termLine(term, '──── 以下为真实命令输出 ────');
    watchResult(term);
    termCmd(term, cmd);
}

/* 组装真正发到终端的命令行：chcp → PATH 注入 → 编译 → 烧录 → 结果哨兵 */
function commandLine(tools, tgt, dirs, buildOnly, progArgs) {
    const q = p => '"' + String(p).replace(/\\/g, '/') + '"';
    const steps = [q(tools.cmake) + ' --build ' + q(tgt.buildDir)];
    if (!buildOnly && tools.programmer && tgt.elf) {
        const args = String(progArgs || DEFAULT_PROG_ARGS).replace(/\{elf\}/g, String(tgt.elf).replace(/\\/g, '/'));
        steps.push(q(tools.programmer) + ' ' + args);
    }
    const head = [];
    if (IS_WIN) head.push('chcp 65001 >nul 2>nul');          // 让终端里的中文提示可读
    const pp = pathPrefix(dirs);
    if (pp) head.push(pp);
    const chain = steps.join(' && ') + ' && echo ' + RESULT_MARK + ' OK || echo ' + RESULT_MARK + ' FAIL';
    return (head.length ? head.join(' & ') + ' && ' : '') + chain;
}

/* 自检：打印识别结果 + 构建期伴随程序(本次故障点) + 构建目录候选 */
async function diagTools() {
    const tools = detectTools(true);        // 自检强制重新探测
    const dirs = toolchainPathDirs(tools);
    const term = getTerm(dirs, true);
    termLine(term, '[STM32] === 环境自检 ===');
    termLine(term, '[STM32] 平台: ' + process.platform + ' / shell: ' + path.basename(shellPath()));
    for (const k of ['cmake', 'ninja', 'gcc', 'programmer']) {
        termLine(term, '  ' + k + ' = ' + (tools[k] ? 'OK: ' + tools[k] : '缺失'));
    }
    const comp = checkCompanions(tools);
    termLine(term, '[STM32] 构建期伴随程序: objcopy=' + (comp.found['arm-none-eabi-objcopy' + EXE] ? 'OK' : '缺失') +
        '  size=' + (comp.found['arm-none-eabi-size' + EXE] ? 'OK' : '缺失'));
    if (comp.missing.length) {
        termLine(term, '[STM32-ERROR] 缺失: ' + comp.missing.join(', ') + ' → 构建会在 POST_BUILD 处 FAILED，烧录不会执行');
    }
    termLine(term, '[STM32] 将前置到 PATH 的目录，共 ' + dirs.length + ' 个:');
    for (const d of dirs) termLine(term, '  ' + d);
    if (!dirs.length) termLine(term, '[STM32-WARN] 无目录可注入 → 若构建报 arm-none-eabi-objcopy 找不到，请配置 stm32flash.extraPathDirs');

    const root = wsRoot();
    if (!root) { termLine(term, '[STM32-WARN] 未打开工作区文件夹'); return; }
    const cands = scanTargets(root.fsPath);
    termLine(term, '[STM32] 构建目录候选 ' + cands.length + ' 个:');
    cands.forEach((c, i) => termLine(term, '  ' + (i + 1) + '] ' + relLabel(root.fsPath, c.buildDir) +
        '  elf=' + (c.hasElf ? c.elf : (c.elf ? c.elf + ' 预期，未生成' : '未找到')) +
        '  ' + new Date(c.mtime).toLocaleString()));
    termLine(term, '[STM32] 已记住的构建目录: ' + (config().get('buildDir', '') || '未设置，将自动选择'));
    term.show(true);
}

/* 手动改选构建目录（清掉记忆后强制弹选择框） */
async function selectBuildDir() {
    const root = wsRoot();
    if (!root) { vscode.window.showErrorMessage('请先打开 STM32 工程文件夹'); return; }
    const term = getTerm(toolchainPathDirs(detectTools()), false);
    const cands = scanTargets(root.fsPath);
    if (!cands.length) { vscode.window.showErrorMessage('未找到 CMake 构建目录'); return; }
    const t = await pickTarget(root.fsPath, cands, term, true);
    if (t) vscode.window.showInformationMessage('STM32: 已选择构建目录 ' + relLabel(root.fsPath, t.buildDir));
}

/* ================= 打开 settings.json 让用户配置 ================= */
async function configureTools() {
    await vscode.commands.executeCommand('workbench.action.openSettingsJson');
    vscode.window.showInformationMessage('可配置: "stm32flash.toolchainDirs"(cmake/ninja/gcc 所在目录数组)、"stm32flash.extraPathDirs"(额外注入 PATH 的目录，如 objcopy/size 所在目录)、"stm32flash.programmer"(烧录器绝对路径)、"stm32flash.buildDir"(默认构建目录)。保存后重新点击按钮。');
}

/* ================= 激活 ================= */
function activate(context) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.LEFT, 100);
    item.text = '$(rocket) 编译并烧录';
    item.tooltip = '编译 → 烧录 → 复位运行\n命令与完整输出都在「' + TERM_NAME + '」终端\n(命令面板可执行「STM32: 终端自检(工具识别)」)';
    item.command = 'stm32.flashAndBuild';
    item.show();

    const reg = (id, fn) => vscode.commands.registerCommand(id,
        () => Promise.resolve().then(fn).catch(e => vscode.window.showErrorMessage('插件内部错误: ' + ((e && e.message) || e))));

    context.subscriptions.push(item,
        reg('stm32.flashAndBuild', flashAndBuild),
        reg('stm32.diag', diagTools),
        reg('stm32.configureTools', configureTools),
        reg('stm32.selectBuildDir', selectBuildDir)
    );
}
function deactivate() { }
module.exports = { activate, deactivate };
// 便于命令行/CI 自检（VS Code 运行时不使用）
module.exports._internals = {
    detectTools, bundlesRoots, resolveTool, versionOf,
    scanTargets, findElfIn, predictElf,
    toolchainPathDirs, checkCompanions, envWithPath, pathPrefix, commandLine, extractErrors,
};
