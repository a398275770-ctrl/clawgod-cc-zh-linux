#!/usr/bin/env node
/**
 * scan-state-access.js — 静态扫描 patch-cli-localizations.js 中裸访问模块级 s / count 的补丁函数
 *
 * 背景：抽离 patch-cli.js 的 23 个结构化补丁时，需把它们对 cli.js 源码（s）与替换计数（count）
 * 的访问全部改为显式 state 注入。手工 grep 函数调用形态会漏掉表达式内的裸标识符访问
 * （如 s.split(x).length、signature.exec(s)）——本轮实测漏了 2 处，均导致测试回归。
 *
 * 本脚本用于迁移期自检，迁移完成后可删除。
 * 用法：node scripts/scan-state-access.js [--file <路径>]
 * 退出码：0 = 无裸访问；1 = 存在裸访问（需改为 state 注入）
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const target = (() => {
  const i = process.argv.indexOf("--file");
  return path.resolve(i >= 0 ? process.argv[i + 1] : "patch-cli-localizations.js");
})();

const lines = fs.readFileSync(target, "utf8").split("\n");
const report = [];
let cur = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const fnMatch = line.match(/^function (install\w+)/);
  if (fnMatch) {
    cur = fnMatch[1];
    continue;
  }
  if (/^\}/.test(line)) {
    cur = null;
    continue;
  }
  if (!cur) continue;

  // 剥离字符串、模板串、注释，避免把字面量内容误判为标识符访问
  const stripped = line
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/\/.*$/, "");

  // 裸 s：前面不是 . 或标识符字符，后面不是 ( （排除 s( 调用与 obj.s）
  if (/(^|[^.\w$])s(?![\w$(])/.test(stripped)) {
    report.push(`${cur} (L${i + 1}): 裸读源码 → ${line.trim().slice(0, 90)}`);
  }
  if (/(^|[^.\w$])count(?![\w$])/.test(stripped)) {
    report.push(`${cur} (L${i + 1}): 裸写计数 → ${line.trim().slice(0, 90)}`);
  }
}

if (report.length) {
  console.error(`scan-state-access: ${report.length} 处裸访问模块级 s/count，需改为 state 注入`);
  for (const r of report) console.error("  " + r);
  console.error("  修复：改为 state.get() / state.set() / state.bump()（见 installDurationFormatterLocalization 范例）");
  process.exit(1);
}
console.log("scan-state-access: OK（无裸 s/count 访问）");
