#!/usr/bin/env node
/**
 * fix-tmpdir-require.js — 修正 migrate-tmpdir.js 的 require 注入位置（一次性修复）
 *
 * 背景：migrate-tmpdir.js 首版把 require 注入到"最后一个 require"之后，而部分测试文件
 * 函数体内也有 require，导致注入点落到函数中部，mkTmpDir 在更早的调用点未定义。
 * migrate-tmpdir.js 已改为注入到"第一个顶层 require"之后；本脚本把已损坏的文件复位。
 *
 * 做法：删掉现有的 helper require 行，再按正确规则重新注入。
 * 用法：node scripts/fix-tmpdir-require.js [--check]
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const HELPER_REL = "./helpers/tmpdir.js";
const CHECK_ONLY = process.argv.includes("--check");
const HELPER_LINE = `const { mkTmpDir } = require("${HELPER_REL}");`;

function listTestFiles() {
  return execSync("git ls-files 'tests/*.test.js'", { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function fixFile(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  let text = fs.readFileSync(abs, "utf8");
  const before = text;

  // 1) 删除现有 helper require 行（含其前导空行，避免留下双空行）
  text = text.replace(new RegExp(`\\n?${HELPER_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`, "g"), "\n");
  // 收紧：上面可能吃掉正常换行，统一把连续 3+ 空行压回 1 个空行
  text = text.replace(/\n{3,}/g, "\n\n");

  // 2) 若该文件仍使用 mkTmpDir，则在第一个顶层 require 后重新注入
  if (/\bmkTmpDir\(/.test(text)) {
    const topRequireRe = /^const .* = require\(["'][^"']+["']\);$/gm;
    const m = topRequireRe.exec(text);
    if (!m) {
      return { relPath, ok: false, error: "找不到顶层 require" };
    }
    const firstEnd = m.index + m[0].length;
    text = text.slice(0, firstEnd) + `\n${HELPER_LINE}` + text.slice(firstEnd);
  }

  if (text === before) return { relPath, ok: true, changed: false };
  if (!CHECK_ONLY) fs.writeFileSync(abs, text);
  return { relPath, ok: true, changed: true };
}

function main() {
  let changed = 0;
  const failures = [];
  for (const f of listTestFiles()) {
    const r = fixFile(f);
    if (!r.ok) failures.push(r);
    else if (r.changed) {
      changed += 1;
      // 报告新位置，便于人工核对是否在第一个 require 之后
      const abs = path.join(REPO_ROOT, f);
      const lines = fs.readFileSync(abs, "utf8").split("\n");
      const idx = lines.findIndex((l) => l === HELPER_LINE);
      console.log(`  ${f}: helper require 现在在第 ${idx + 1} 行`);
    }
  }
  console.log(`${CHECK_ONLY ? "[check] " : ""}修正 ${changed} 个文件`);
  if (failures.length) {
    for (const f of failures) console.error(`  ${f.relPath}: ${f.error}`);
    process.exit(1);
  }
}

main();
