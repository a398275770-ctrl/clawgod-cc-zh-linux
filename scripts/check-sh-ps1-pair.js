#!/usr/bin/env node
/**
 * check-sh-ps1-pair.js — sh/ps1 成对变更检查（决策 D3：保持双实现，改动必须成对）
 *
 * 规则：diff 范围内变更了成对文件的一侧而另一侧未变，即失败：
 *   install.sh              ↔  install.ps1
 *   uninstall.sh            ↔  uninstall.ps1
 *   plugin/hooks/session-start      ↔  plugin/hooks/session-start.ps1
 *   plugin/hooks/notification       ↔  plugin/hooks/notification.ps1
 *
 * hook 双端于 2026-10-13 纳入（台账 TD-COMPLEX-005）：此前 PAIRS 只含 install/uninstall，
 * 而 session-start hook 双端共 1216 行、承载「注入中文上下文 + Release 更新检测 +
 * 版本变更重 patch」核心逻辑，属上一轮 TD-PAIR-001~004 同类风险却无门禁保护。
 * 注：`session-start.cmd` / `notification.cmd` 是 2 行转发壳（调对应 .ps1），不纳入。
 *
 * 豁免：diff 范围内任一 commit message 含 "pair-exempt: <原因>" 即放行（显式、可追溯）。
 *
 * 用法：node scripts/check-sh-ps1-pair.js [--base <git-ref>] [--repo <目录>]
 * 退出码：0 通过；1 存在未成对变更。
 */

"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const repoIdx = args.indexOf("--repo");
const REPO = repoIdx >= 0 ? path.resolve(args[repoIdx + 1]) : path.resolve(__dirname, "..");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "origin/main";

const PAIRS = [
  ["install.sh", "install.ps1"],
  ["uninstall.sh", "uninstall.ps1"],
  ["plugin/hooks/session-start", "plugin/hooks/session-start.ps1"],
  ["plugin/hooks/notification", "plugin/hooks/notification.ps1"],
];

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { cwd: REPO, encoding: "utf8" }).trim();
}

function main() {
  let base = BASE;
  try {
    base = git("merge-base", BASE, "HEAD");
  } catch {
    console.error(`check-sh-ps1-pair: 无法解析 base "${BASE}"`);
    console.error("  修复：用 --base <git-ref> 指定对比基准（如 origin/main 或具体 sha）。");
    process.exit(1);
  }

  const changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  if (!changed.length) {
    console.log("check-sh-ps1-pair: OK（无文件变更）");
    return;
  }

  const log = git("log", "--format=%B", `${base}..HEAD`);
  const exempted = /pair-exempt:\s*\S+/.test(log);

  const violations = [];
  for (const [a, b] of PAIRS) {
    const hasA = changed.includes(a);
    const hasB = changed.includes(b);
    if (hasA !== hasB) {
      violations.push(`变更了 ${hasA ? a : b}，但未同步变更 ${hasA ? b : a}`);
    }
  }

  if (violations.length && !exempted) {
    console.error("check-sh-ps1-pair: sh/ps1 双实现必须成对变更（决策 D3）");
    for (const v of violations) console.error("  " + v);
    console.error("  修复：把同一逻辑同步改到另一端（两端是同一安装/卸载流程的双语言实现）；");
    console.error("        确属单端变更的，在 commit message 中写明 \"pair-exempt: <原因>\"。");
    process.exit(1);
  }
  console.log(`check-sh-ps1-pair: OK（${changed.length} 个变更文件${exempted && violations.length ? "，含显式豁免" : ""}）`);
}

main();
