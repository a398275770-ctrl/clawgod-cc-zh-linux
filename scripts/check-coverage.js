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

// plugin/ 下的负载副本：与根目录源文件字节一致时视为同一份代码，覆盖率只计一次。
// 副本由 scripts/sync-payload.sh 从根复制（core-beliefs #15），不是第二源码树。
// 有意保留差异的副本（如 install-json-helper.js 的 require 路径适配）不排除，独立统计。
const PAYLOAD_MIRRORS = new Set([
  "plugin/patch-cli.js",
  "plugin/patch-cli.sh",
  "plugin/cli-translations.json",
  "plugin/bun-binary-io.js",
  "plugin/compute-patch-revision.sh",
  "plugin/settings-overlay.json",
  "plugin/verbs/zh-CN.json",
  "plugin/tips/zh-CN.json",
  "plugin/bin/doctor",
  "plugin/bin/doctor.ps1",
  "plugin/scripts/zh-cn-doctor.js",
  "plugin/scripts/patch-bytecode.js",
  "plugin/scripts/native-repair.js",
  "plugin/scripts/detect-clawgod.js",
  "plugin/scripts/patch-bunfs.js",
]);

function isPayloadMirror(sf) {
  if (!PAYLOAD_MIRRORS.has(sf)) return false;
  // 只有当副本与根源逐字节一致时才是"同一份代码"；有差异说明它已独立演化，应单独统计
  // plugin/scripts/x.js 的根源是 scripts/x.js（去掉 plugin/ 前缀即可对上 sync-payload.sh 的映射）
  const rootRelative = sf.replace(/^plugin\//, "");
  const rootPath = path.join(REPO_ROOT, rootRelative);
  if (!fs.existsSync(rootPath)) return false;
  try {
    return fs.readFileSync(rootPath).equals(fs.readFileSync(path.join(REPO_ROOT, sf)));
  } catch {
    return false;
  }
}

function isRepoSourceFile(sf) {
  // 只统计仓库内源码：仓库内文件是形如 scripts/x.js、plugin/... 的纯相对路径；
  // 测试临时目录的 fixture 副本以 ../.. 开头（或绝对路径），一律排除
  if (path.isAbsolute(sf)) return false;
  if (sf.split("/").includes("..")) return false;
  if (sf.startsWith("tests/")) return false;
  if (!/\.(js|mjs|cjs)$/.test(sf)) return false;
  if (isPayloadMirror(sf)) return false; // 与根字节一致的负载副本不双计
  return true;
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

  // 低覆盖下限（TD-QA-007）：任一仓库内源文件行覆盖过低即失败，避免"整体达标但单文件几乎没测"。
  // 已知无法单测的文件（如需真实 native binary fixture）在 floor.exempt 显式登记，带 reason + expires。
  const floor = thresholds.floor || {};
  const floorMin = typeof floor.minLineRate === "number" ? floor.minLineRate : null;
  const floorExempt = new Set(Object.keys(floor.exempt || {}));
  if (floorMin !== null) {
    const low = [];
    for (const [sf, m] of repoFiles) {
      if (floorExempt.has(sf)) continue;
      if (m.lineRate < floorMin) low.push(`  ${sf}: 行 ${m.lineRate.toFixed(2)}%（${m.lh}/${m.lf}）< 下限 ${floorMin}%`);
    }
    if (low.length) {
      failures.push(`${low.length} 个源文件行覆盖低于下限 ${floorMin}%：\n${low.join("\n")}`);
    }
  }
  const expiredExemptions = Object.entries(floor.exempt || {})
    .filter(([, meta]) => meta && meta.expires && new Date(meta.expires) < new Date())
    .map(([sf, meta]) => `  ${sf}: 豁免已于 ${meta.expires} 过期`);
  if (expiredExemptions.length) {
    failures.push(`低覆盖豁免已过期（请补测试或重新登记）：\n${expiredExemptions.join("\n")}`);
  }

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
    console.error("        阈值本身不合理的，在 scripts/coverage-thresholds.json 调整并在 PR 描述中说明理由；");
    console.error("        确属无法单测的文件，在 floor.exempt 登记 { reason, expires }（到期自动恢复拦截）。");
    process.exit(1);
  }
  console.log("check-coverage: OK（全部达标）");
}

main();
