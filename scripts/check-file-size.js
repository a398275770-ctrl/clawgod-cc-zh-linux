#!/usr/bin/env node
/**
 * check-file-size.js — 文件大小上限门禁（品味不变量 T1，零依赖）
 *
 * 规则：git 跟踪的 *.js / *.sh / *.ps1 文件不得超过 MAX_LINES 行。
 * 当前存量最大 1938 行（patch-cli.js），上限设为 2000 —— 阻止继续膨胀；
 * 存量超大文件的压降目标见 docs/exec-plans/tech-debt-tracker.md（TD-COMPLEX-*）。
 *
 * 豁免：scripts/gate-exemptions.json 中按文件登记（须带 reason 与 expires）。
 *
 * 用法：node scripts/check-file-size.js [--root <仓库根>] [--max <行数>]
 * 退出码：0 通过；1 存在超限文件。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const maxIdx = args.indexOf("--max");
const ROOT = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.resolve(__dirname, "..");
const MAX_LINES = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 2000;

const EXEMPTIONS_FILE = path.join(ROOT, "scripts", "gate-exemptions.json");

function loadExemptions() {
  try {
    const all = JSON.parse(fs.readFileSync(EXEMPTIONS_FILE, "utf8")).exemptions || [];
    const today = new Date().toISOString().slice(0, 10);
    return new Map(
      all
        .filter((e) => e && e.check === "file-size" && e.path && e.expires >= today)
        .map((e) => [e.path, e])
    );
  } catch {
    return new Map();
  }
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "*.js", "*.sh", "*.ps1"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

const exemptions = loadExemptions();
const violations = [];

for (const rel of trackedFiles()) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const lines = fs.readFileSync(abs, "utf8").split("\n").length - 1;
  if (lines <= MAX_LINES) continue;
  if (exemptions.has(rel)) continue;
  violations.push({ rel, lines });
}

if (violations.length) {
  console.error(`check-file-size: ${violations.length} 个文件超过 ${MAX_LINES} 行`);
  for (const v of violations) {
    console.error(`  ${v.rel}: ${v.lines} 行`);
    console.error(`  修复：按职责拆分该文件（目标形态见 ARCHITECTURE.md「依赖方向规则」）；`);
    console.error(`        确属例外的，在 scripts/gate-exemptions.json 登记 {check:"file-size", path:"${v.rel}", reason, expires}（到期自动失效）。`);
  }
  process.exit(1);
}
console.log(`check-file-size: OK（全部跟踪文件 ≤ ${MAX_LINES} 行）`);
