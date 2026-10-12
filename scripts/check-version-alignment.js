#!/usr/bin/env node
/**
 * check-version-alignment.js — 版本声明点一致性校验（零依赖）
 *
 * 版本声明点（共 3 处，TD-VER-001 结论；marketplace.json 按官方规范无 version 字段）：
 *   1. plugin/manifest.json .version
 *   2. plugin/.claude-plugin/plugin.json .version
 *   3. CHANGELOG.md 顶部第一个 "## [x.y.z]" 段落
 *
 * 用法：node scripts/check-version-alignment.js [--root <仓库根>]
 * 退出码：0 一致；1 漂移或文件缺失。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const ROOT = rootIdx >= 0 ? path.resolve(args[rootIdx + 1]) : path.resolve(__dirname, "..");

function readJsonVersion(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { error: `缺失 ${rel}` };
  try {
    const v = JSON.parse(fs.readFileSync(abs, "utf8")).version;
    if (!v) return { error: `${rel} 无 version 字段` };
    return { version: String(v) };
  } catch (e) {
    return { error: `${rel} JSON 解析失败：${e.message}` };
  }
}

function readChangelogVersion(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { error: `缺失 ${rel}` };
  const m = fs.readFileSync(abs, "utf8").match(/^## \[(\d+\.\d+\.\d+)\]/m);
  if (!m) return { error: `${rel} 未找到 "## [x.y.z]" 版本段落` };
  return { version: m[1] };
}

const points = [
  { name: "plugin/manifest.json", ...readJsonVersion("plugin/manifest.json") },
  { name: "plugin/.claude-plugin/plugin.json", ...readJsonVersion("plugin/.claude-plugin/plugin.json") },
  { name: "CHANGELOG.md 顶部", ...readChangelogVersion("CHANGELOG.md") },
];

const errors = points.filter((p) => p.error).map((p) => `${p.name}: ${p.error}`);
const versions = points.filter((p) => p.version).map((p) => p.version);
if (!errors.length && new Set(versions).size !== 1) {
  for (const p of points) errors.push(`${p.name} = ${p.version}`);
}

if (errors.length) {
  console.error("check-version-alignment: 版本声明点不一致");
  for (const e of errors) console.error("  " + e);
  console.error("  修复：按 CLAUDE.md「版本发布流程」同步 3 处声明点（manifest.json → plugin.json → CHANGELOG 顶部段落），保持一致后再提交。");
  process.exit(1);
}
console.log(`check-version-alignment: OK（3 处声明点均为 ${versions[0]}）`);
