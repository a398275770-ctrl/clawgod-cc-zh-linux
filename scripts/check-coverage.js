#!/usr/bin/env node
/**
 * check-coverage.js — 测试覆盖率门禁（决策 D4：Node 内置覆盖率，零依赖）
 *
 * 用法：
 *   node scripts/check-coverage.js                    # 跑全量测试+覆盖率并按阈值校验（约 60s）
 *   node scripts/check-coverage.js --lcov <file>      # 校验已有 lcov 报告
 *   node scripts/check-coverage.js --report           # 只打印汇总，不校验阈值
 *
 * 阈值：scripts/coverage-thresholds.json
 *   overall：全仓行/分支/函数覆盖率下限（百分比）
 *   keyFiles：关键模块各自的行覆盖率下限
 * 豁免：不适用（覆盖率只能补测试或调阈值，调阈值须在 PR 中说明理由）。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const THRESHOLDS_FILE = path.join(REPO_ROOT, "scripts", "coverage-thresholds.json");

function parseLcov(text) {
  // 返回 Map<sf, {lineRate, branchRate, funcRate}>
  const files = new Map();
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      cur = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };
      files.set(line.slice(3), cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith("LF:")) cur.lf = Number(line.slice(3));
    else if (line.startsWith("LH:")) cur.lh = Number(line.slice(3));
    else if (line.startsWith("BRF:")) cur.brf = Number(line.slice(4));
    else if (line.startsWith("BRH:")) cur.brh = Number(line.slice(4));
    else if (line.startsWith("FNF:")) cur.fnf = Number(line.slice(4));
    else if (line.startsWith("FNH:")) cur.fnh = Number(line.slice(4));
  }
  const out = new Map();
  for (const [sf, m] of files) {
    out.set(sf, {
      lineRate: m.lf ? (100 * m.lh) / m.lf : 100,
      branchRate: m.brf ? (100 * m.brh) / m.brf : 100,
      funcRate: m.fnf ? (100 * m.fnh) / m.fnf : 100,
      ...m,
    });
  }
  return out;
}

function isRepoSourceFile(sf) {
  // 只统计仓库内源码：仓库内文件是形如 scripts/x.js、plugin/... 的纯相对路径；
  // 测试临时目录的 fixture 副本以 ../.. 开头（或绝对路径），一律排除
  if (path.isAbsolute(sf)) return false;
  if (sf.split("/").includes("..")) return false;
  if (sf.startsWith("tests/")) return false;
  return /\.(js|mjs|cjs)$/.test(sf);
}

function aggregate(metrics) {
  let lf = 0, lh = 0, brf = 0, brh = 0, fnf = 0, fnh = 0;
  for (const m of metrics.values()) {
    lf += m.lf; lh += m.lh; brf += m.brf; brh += m.brh; fnf += m.fnf; fnh += m.fnh;
  }
  return {
    lineRate: lf ? (100 * lh) / lf : 100,
    branchRate: brf ? (100 * brh) / brf : 100,
    funcRate: fnf ? (100 * fnh) / fnf : 100,
  };
}

function runCoverage() {
  const r = spawnSync(
    process.execPath,
    ["--test", "--experimental-test-coverage", "--test-reporter=lcov", "tests/"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.error) throw r.error;
  const testSummary = (r.stderr || "").split("\n").filter((l) => /ℹ (tests|pass|fail) /.test(l));
  const failLine = testSummary.find((l) => l.includes("ℹ fail "));
  if (failLine && !/ℹ fail 0/.test(failLine)) {
    console.error("check-coverage: 测试套件存在失败，先修测试再谈覆盖率：\n  " + failLine.trim());
    process.exit(1);
  }
  return r.stdout;
}

function main() {
  const args = process.argv.slice(2);
  const lcovIdx = args.indexOf("--lcov");
  const reportOnly = args.includes("--report");

  const lcovText = lcovIdx >= 0 ? fs.readFileSync(args[lcovIdx + 1], "utf8") : runCoverage();
  const metrics = parseLcov(lcovText);

  const repoFiles = new Map([...metrics].filter(([sf]) => isRepoSourceFile(sf)));
  if (repoFiles.size === 0) {
    console.error("check-coverage: 未解析到任何仓库内源码文件\n  修复：确认在仓库根运行；--lcov 模式确认报告由本仓库测试产出。");
    process.exit(1);
  }
  const overall = aggregate(repoFiles);

  const thresholds = JSON.parse(fs.readFileSync(THRESHOLDS_FILE, "utf8"));

  console.log(`覆盖率（仓库内源码 ${repoFiles.size} 个文件）：`);
  console.log(`  行 ${overall.lineRate.toFixed(2)}% / 分支 ${overall.branchRate.toFixed(2)}% / 函数 ${overall.funcRate.toFixed(2)}%`);

  if (reportOnly) return;

  const failures = [];
  const t = thresholds.overall;
  if (overall.lineRate < t.lines) failures.push(`整体行覆盖 ${overall.lineRate.toFixed(2)}% < 下限 ${t.lines}%`);
  if (overall.branchRate < t.branches) failures.push(`整体分支覆盖 ${overall.branchRate.toFixed(2)}% < 下限 ${t.branches}%`);
  if (overall.funcRate < t.functions) failures.push(`整体函数覆盖 ${overall.funcRate.toFixed(2)}% < 下限 ${t.functions}%`);

  for (const [file, floor] of Object.entries(thresholds.keyFiles || {})) {
    const m = repoFiles.get(file);
    if (!m) {
      failures.push(`关键模块 ${file} 未出现在覆盖率报告中（测试未加载它）`);
      continue;
    }
    console.log(`  ${file}: 行 ${m.lineRate.toFixed(2)}%（下限 ${floor}%）`);
    if (m.lineRate < floor) failures.push(`关键模块 ${file} 行覆盖 ${m.lineRate.toFixed(2)}% < 下限 ${floor}%`);
  }

  if (failures.length) {
    console.error(`check-coverage: ${failures.length} 项未达标`);
    for (const f of failures) console.error("  " + f);
    console.error("  修复：为未覆盖路径补测试（未覆盖行号见 node --test --experimental-test-coverage tests/ 输出）；");
    console.error("        阈值本身不合理的，在 scripts/coverage-thresholds.json 调整并在 PR 描述中说明理由。");
    process.exit(1);
  }
  console.log("check-coverage: OK（全部达标）");
}

main();
