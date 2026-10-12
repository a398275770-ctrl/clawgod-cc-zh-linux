#!/usr/bin/env node
/**
 * check-structure.js — 结构测试：架构约束的机械校验（§4.1 依赖方向、批次 3a 防回退）
 *
 * 规则：
 *   S1  安装脚本（install.sh / uninstall.sh）不得出现超过 30 行的 node heredoc 正文
 *       （业务逻辑必须下沉 scripts/ 独立文件，见 ARCHITECTURE.md 依赖方向规则 1）。
 *   S2  仓库内 JS 源码不得 require/import 仓库外路径（`..` 上溯逃逸）——
 *       payload 自包含（plugin/ 副本独立可运行）。
 *
 * 用法：node scripts/check-structure.js [--root <仓库根>]
 * 退出码：0 通过；1 存在违规。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.resolve(__dirname, "..");

const MAX_HEREDOC_LINES = 30;
const violations = [];

// ---- S1: 安装脚本 heredoc 长度 ----
for (const script of ["install.sh", "uninstall.sh"]) {
  const file = path.join(ROOT, script);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start < 0 && /<<'NODE'/.test(lines[i])) start = i;
    else if (start >= 0 && lines[i] === "NODE") {
      const size = i - start - 1;
      if (size > MAX_HEREDOC_LINES) {
        violations.push(
          `S1 ${script}:${start + 1}: node heredoc ${size} 行（上限 ${MAX_HEREDOC_LINES}）\n` +
          `  修复：把这段 JS 抽成 scripts/ 独立文件（可单测），脚本内改为 node "$SCRIPT_DIR/scripts/<name>.js" 调用；` +
          `参考批次 3a 的 scripts/reconcile-standalone-hooks.js 做法。`
        );
      }
      start = -1;
    }
  }
}

// ---- S2: require/import 不得逃逸仓库 ----
const REQUIRE_RE = /(?:require\(|from\s+)["'`]([^"'`]+)["'`]/g;
let jsFiles = [];
try {
  jsFiles = execFileSync("git", ["ls-files", "*.js", "*.mjs", "*.cjs"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.startsWith("tests/") && !f.startsWith("docs/"));
} catch {
  // 非 git 环境（如测试夹具）：遍历目录
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".git", "tests", "docs"].includes(e.name)) continue;
        walk(p);
      } else if (/\.(js|mjs|cjs)$/.test(e.name)) jsFiles.push(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
}

for (const rel of jsFiles) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const content = fs.readFileSync(abs, "utf8");
  let m;
  while ((m = REQUIRE_RE.exec(content))) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue; // 内置模块与包名不检查
    const resolved = path.resolve(path.dirname(abs), spec);
    if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
      violations.push(
        `S2 ${rel}: require/import "${spec}" 逃逸到仓库外\n` +
        `  修复：payload 文件必须自包含——把被依赖文件纳入同一分发单元（plugin/ 或 scripts/），` +
        `或把依赖内容内联；不允许跨出仓库边界引用。`
      );
    }
  }
}

if (violations.length) {
  console.error(`check-structure: ${violations.length} 处违规`);
  for (const v of violations) console.error("  " + v.split("\n").join("\n  "));
  process.exit(1);
}
console.log(`check-structure: OK（S1 heredoc ≤${MAX_HEREDOC_LINES} 行；S2 无仓库外引用）`);
