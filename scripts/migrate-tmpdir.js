#!/usr/bin/env node
/**
 * migrate-tmpdir.js — 把 tests/*.test.js 的裸 mkdtempSync 调用迁移到
 * tests/helpers/tmpdir.js 的 mkTmpDir()（自动清理，修 TD-QA-008）。
 *
 * 只处理统一形态：fs.mkdtempSync(path.join(os.tmpdir(), <前缀表达式>))
 * 其他形态（如嵌套在 path.join(...) 内、含额外参数）跳过并报告，由人工处理。
 *
 * 用法：
 *   node scripts/migrate-tmpdir.js            # 应用迁移
 *   node scripts/migrate-tmpdir.js --check    # 只报告，不写文件
 *
 * 幂等：已迁移过的文件不再改动。迁移后必须跑 node --test tests/ 确认无回归。
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const TESTS_DIR = path.join(REPO_ROOT, "tests");
const HELPER_REL = "./helpers/tmpdir.js";

const CHECK_ONLY = process.argv.includes("--check");

// 统一形态：fs.mkdtempSync(path.join(os.tmpdir(), <expr>))
// <expr> 可为字符串字面量、模板字面量（可含 ${...}）或**标识符**（如 name）。
// 标识符形态（如 `mkdtempSync(path.join(os.tmpdir(), name))`）此前不在匹配范围，
// 导致 tests/install-json-helper.test.js 这类包装函数漏检——实测泄漏 3 个目录/轮。
// mkTmpDir 接受任意字符串，故标识符形态同样可自动迁移。
const CALL_RE = /fs\.mkdtempSync\(\s*path\.join\(\s*os\.tmpdir\(\)\s*,\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|[A-Za-z_$][\w$]*))\s*\)\s*\)/g;

function listTestFiles() {
  return execSync("git ls-files 'tests/*.test.js'", { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function migrateFile(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  const original = fs.readFileSync(abs, "utf8");
  let text = original;
  let count = 0;

  text = text.replace(CALL_RE, (_m, prefixExpr) => {
    count += 1;
    return `mkTmpDir(${prefixExpr})`;
  });

  if (count === 0) return { relPath, count: 0, changed: false, skipped: 0 };

  // 注入 require（若尚未引入）。必须放在**第一个**顶层 require 之后：
  // 有些文件的函数体内也有 require（如 session-start-hook.test.js 中部的
  // require(path.join(repoRoot, ...))），若匹配到"最后一个"会把注入点推到
  // 函数体中间，导致 mkTmpDir 在更早的调用点未定义（TD-QA-008 迁移实测踩过）。
  if (!/require\(["']\.\/helpers\/tmpdir\.js["']\)/.test(text)) {
    // 顶层 require：行首无缩进的 const ... = require("...");
    const topRequireRe = /^const .* = require\(["'][^"']+["']\);$/gm;
    const m = topRequireRe.exec(text);
    if (!m) {
      return { relPath, count, changed: false, skipped: count, error: "找不到顶层 require 块，无法注入 helper" };
    }
    const firstEnd = m.index + m[0].length;
    const inject = `\nconst { mkTmpDir } = require("${HELPER_REL}");`;
    text = text.slice(0, firstEnd) + inject + text.slice(firstEnd);
  }

  // 统计文件中残留的裸 mkdtempSync（说明有非统一形态，需人工处理）
  const remaining = (text.match(/fs\.mkdtempSync\(/g) || []).length;

  if (!CHECK_ONLY) fs.writeFileSync(abs, text);
  return { relPath, count, changed: true, skipped: remaining };
}

function main() {
  const files = listTestFiles();
  const results = [];
  for (const f of files) results.push(migrateFile(f));

  const migrated = results.filter((r) => r.changed);
  const totalCalls = results.reduce((s, r) => s + r.count, 0);
  const withRemaining = results.filter((r) => r.skipped > 0);

  console.log(`${CHECK_ONLY ? "[check] " : ""}迁移 ${migrated.length} 个文件，替换 ${totalCalls} 处调用`);
  if (withRemaining.length) {
    console.log(`\n以下文件仍有裸 mkdtempSync（非统一形态，需人工处理）：`);
    for (const r of withRemaining) console.log(`  ${r.relPath}: 残留 ${r.skipped} 处`);
  }
  const errors = results.filter((r) => r.error);
  if (errors.length) {
    console.log(`\n失败：`);
    for (const r of errors) console.log(`  ${r.relPath}: ${r.error}`);
    process.exit(1);
  }
  if (CHECK_ONLY && totalCalls > 0) process.exit(1);
}

main();
