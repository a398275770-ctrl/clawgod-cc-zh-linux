#!/usr/bin/env node
/**
 * check-doc-freshness.js — 文档园丁：校验文档中的可复算数字与门禁清单是否仍与代码一致（零依赖）
 *
 * 解决的问题（§8.2 熵管理）：文档会随代码演进而漂移。死链与必填节由 check-doc-links.js 守，
 * 派生计数由 sync-doc-derived-counts.js 守；本文补上剩下的两类**可机械复算**的漂移：
 *
 *   1. QUALITY_SCORE.md「评分依据」里的度量数字（测试用例数、文件行数、覆盖率）
 *   2. docs/GATES.md 的门禁清单 vs scripts/check-all.sh 实际执行的步骤
 *
 * 设计边界（重要）：
 *   - **只校验有唯一真相来源的数字**。主观评分、结论性描述、耗时等不校验——那是人的事。
 *   - 数字用 `度量 → 文档值` 对照表声明，真相一律现算，不信任文档里的旧值。
 *   - 报错必须含修复指令（§4.2 硬要求），让智能体读完知道改哪里。
 *
 * 用法：
 *   node scripts/check-doc-freshness.js            # 校验
 *   node scripts/check-doc-freshness.js --write    # 自动更新文档中的过期数字
 *
 * 退出码：0 通过；1 存在漂移。
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");

const QUALITY_SCORE = path.join(REPO_ROOT, "docs", "QUALITY_SCORE.md");
const GATES = path.join(REPO_ROOT, "docs", "GATES.md");
const CHECK_ALL = path.join(REPO_ROOT, "scripts", "check-all.sh");

function fail(msg) {
  console.error(`check-doc-freshness: ${msg}`);
  process.exit(1);
}

// ---------- 真相来源：现算 ----------

function countLines(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n").length - 1;
}

function countTests() {
  // 跑全量测试取用例总数（约 35s）；失败也照样有 tests 行
  const r = spawnSync(process.execPath, ["--test", "tests/"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 300000,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const m = out.match(/^ℹ tests (\d+)$/m);
  if (!m) fail("无法解析测试用例数（node --test 输出异常）\n  修复：手动跑 node --test tests/ 确认测试可运行");
  return Number(m[1]);
}

function readCoverage() {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "check-coverage.js"), "--report"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 300000,
  });
  const m = (r.stdout || "").match(/行 ([\d.]+)% \/ 分支 ([\d.]+)% \/ 函数 ([\d.]+)%/);
  if (!m) fail("无法解析覆盖率（check-coverage --report 输出异常）\n  修复：手动跑 node scripts/check-coverage.js --report 确认可用");
  const fileCount = Number(((r.stdout || "").match(/仓库内源码 (\d+) 个文件/) || [])[1]);
  return { lines: m[1], branches: m[2], functions: m[3], fileCount };
}

function maxFunctionLines(file) {
  // awk 度量：函数声明到第一个行首 } 的行数
  const out = execFileSync(
    "awk",
    [
      `/^[a-zA-Z_][a-zA-Z0-9_]*\\(\\) *\\{/ {name=$1; start=NR} /^\\}/ {if (name!="") {print NR-start+1, name; name=""}}`,
      path.join(REPO_ROOT, file),
    ],
    { encoding: "utf8" }
  );
  const rows = out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim().split(/\s+/))
    .map(([n, name]) => ({ n: Number(n), name }));
  rows.sort((a, b) => b.n - a.n);
  return rows[0] || { n: 0, name: "(无函数)" };
}

function checkAllSteps() {
  const text = fs.readFileSync(CHECK_ALL, "utf8");
  const steps = new Set();
  for (const m of text.matchAll(/(?:node|bash) (scripts\/[a-z0-9-]+\.(?:js|sh))/g)) steps.add(m[1]);
  // 自我引用与说明性提及不是门禁步骤
  steps.delete("scripts/check-all.sh");
  steps.delete("scripts/sync-payload.sh"); // 只作为「修复指引」出现在内嵌 bash 里
  steps.delete("scripts/install-git-hooks.sh"); // 同上，安装钩子的说明
  return steps;
}

// ---------- 文档值抽取 ----------

function readQualityScoreClaims() {
  if (!fs.existsSync(QUALITY_SCORE)) {
    console.error(`check-doc-freshness: 缺少 ${path.relative(REPO_ROOT, QUALITY_SCORE)}
  修复：创建该文档（必填节见 check-doc-links.js 的 REQUIRED_SECTIONS）。`);
    return {};
  }
  const text = fs.readFileSync(QUALITY_SCORE, "utf8");
  const claims = {};

  // 测试基线行：「node --test tests/ → 549 用例 / ...」
  const tests = text.match(/node --test tests\/`?\s*→\s*(\d+)\s*用例/);
  if (tests) claims.tests = Number(tests[1]);

  // 复杂度行：「install.sh 1360 行」「install.ps1 1382 行」「patch-cli.js 1135 行」
  const complexity = text.match(/\*\*复杂度\*\*：[\s\S]*?(?=\n- \*\*|$)/);
  if (complexity) {
    const lineCounts = {};
    for (const m of complexity[0].matchAll(/([a-zA-Z0-9_.-]+\.(?:sh|ps1|js))\s+(\d+)\s*行/g)) {
      lineCounts[m[1]] = Number(m[2]);
    }
    claims.lineCounts = lineCounts;
  }

  // 覆盖率：只认「真实口径」行（剔除 plugin/ 副本后的整体）。
  // 文档里可能并列多个口径（门禁旧口径 / 真实口径），只有真实口径是园丁维护对象——
  // 否则会把新数字写进语义相反的那一行。
  const cov = text.match(/真实口径[^\n]*?行\s*\*\*([\d.]+)%\*\*/);
  if (cov) claims.coverage = { lines: cov[1] };
  else {
    const cov2 = text.match(/整体行\s*([\d.]+)%\s*\/\s*分支\s*([\d.]+)%\s*\/\s*函数\s*([\d.]+)%/);
    if (cov2) claims.coverage = { lines: cov2[1], branches: cov2[2], functions: cov2[3] };
  }

  return claims;
}

function readGatesClaims() {
  if (!fs.existsSync(GATES)) {
    console.error(`check-doc-freshness: 缺少 ${path.relative(REPO_ROOT, GATES)}
  修复：创建该文档，并在表格中登记本地门禁（入口列 + 触发列含 check-all）。`);
    return new Set();
  }
  // 只取门禁表格里「触发」列声明包含 check-all 的行——那些才是本地门禁步骤。
  // GATES.md 里还有大量仅 CI 执行的门禁（触发列写「CI：PR」「CI：push main」），
  // 它们本就不该出现在 check-all.sh 里；不读触发列会把它们误报为漂移。
  // 入口列形如 `node scripts/x.js`、`bash scripts/preflight.sh --base <ref>`，允许带参数。
  const text = fs.readFileSync(GATES, "utf8");
  const steps = new Set();
  for (const line of text.split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells: [0]="" [1]=检查名 [2]=入口 [3]=触发 ...
    const entry = cells[2];
    const trigger = cells[3] || "";
    if (!entry || !/check-all/i.test(trigger)) continue;
    const m = entry.match(/`(?:(?:node|bash) )?(scripts\/[a-z0-9-]+\.(?:js|sh))(?:\s+[^`]*)?`/);
    if (m && m[1] !== "scripts/check-all.sh") steps.add(m[1]);
  }
  return steps;
}

// ---------- 主流程 ----------

function main() {
  const problems = [];
  const fixes = [];

  console.log("文档园丁：现算真相来源…");
  const truth = {
    tests: countTests(),
    installSh: countLines("install.sh"),
    installPs1: countLines("install.ps1"),
    patchCli: countLines("patch-cli.js"),
    localizations: countLines("patch-cli-localizations.js"),
    coverage: readCoverage(),
    maxFn: maxFunctionLines("install.sh"),
    checkAllSteps: checkAllSteps(),
  };
  console.log(`  测试用例 ${truth.tests}｜install.sh ${truth.installSh} 行｜install.ps1 ${truth.installPs1} 行`);
  console.log(`  patch-cli.js ${truth.patchCli} 行｜localizations ${truth.localizations} 行`);
  console.log(`  覆盖率 行 ${truth.coverage.lines}% / 分支 ${truth.coverage.branches}% / 函数 ${truth.coverage.functions}%（${truth.coverage.fileCount} 文件）`);
  console.log(`  install.sh 最大函数 ${truth.maxFn.n} 行（${truth.maxFn.name}）`);
  console.log(`  check-all.sh 步骤 ${truth.checkAllSteps.size} 项\n`);

  const claims = readQualityScoreClaims();

  // 1) 测试用例数
  if (claims.tests !== undefined && claims.tests !== truth.tests) {
    problems.push(`QUALITY_SCORE.md 声称测试基线 ${claims.tests} 用例，实际 ${truth.tests}`);
    fixes.push({ file: QUALITY_SCORE, from: new RegExp(`(${"`node --test tests/`"}?\\s*→\\s*)${claims.tests}(\\s*用例)`), to: `$1${truth.tests}$2`, what: "测试用例数" });
  }

  // 2) 文件行数（只校验复杂度行里出现的文件）
  for (const [file, claimed] of Object.entries(claims.lineCounts || {})) {
    const actual = { "install.sh": truth.installSh, "install.ps1": truth.installPs1, "patch-cli.js": truth.patchCli }[file];
    if (actual === undefined) continue;
    if (claimed !== actual) {
      problems.push(`QUALITY_SCORE.md 声称 ${file} ${claimed} 行，实际 ${actual} 行`);
      fixes.push({ file: QUALITY_SCORE, from: new RegExp(`(${file.replace(/[.]/g, "\\.")}\\s+)${claimed}(\\s*行)`), to: `$1${actual}$2`, what: `${file} 行数` });
    }
  }

  // 3) 覆盖率
  if (claims.coverage) {
    const c = claims.coverage;
    const t = truth.coverage;
    if (c.lines !== t.lines) {
      problems.push(
        `QUALITY_SCORE.md 声称真实口径行覆盖 ${c.lines}%，实际 ${t.lines}%（分支 ${t.branches}% / 函数 ${t.functions}%，${t.fileCount} 文件）`
      );
      fixes.push({
        file: QUALITY_SCORE,
        // 只替换「真实口径」行里的行覆盖率，不碰其他口径的叙述
        from: /(真实口径[^\n]*?行\s*\*\*)[\d.]+(%\*\*)/,
        to: `$1${t.lines}$2`,
        what: "真实口径行覆盖率",
      });
    }
  }

  // 4) GATES.md 门禁清单 vs check-all.sh 实际步骤
  const gatesSteps = readGatesClaims();
  const actual = truth.checkAllSteps;
  const listedNotRun = [...gatesSteps].filter((s) => !actual.has(s));
  const runNotListed = [...actual].filter((s) => !gatesSteps.has(s));
  if (listedNotRun.length) {
    problems.push(`GATES.md 列出了 check-all.sh 未执行的门禁：${listedNotRun.join(", ")}`);
    fixes.push({ file: GATES, manual: `把这些门禁标注为「仅 CI 执行」，或从 GATES.md 移除`, what: "GATES 清单多列" });
  }
  if (runNotListed.length) {
    problems.push(`check-all.sh 执行了 GATES.md 未登记的门禁：${runNotListed.join(", ")}`);
    fixes.push({ file: GATES, manual: `在 GATES.md 补登记这些门禁（含失败含义与修复指引）`, what: "GATES 清单漏登" });
  }

  if (!problems.length) {
    console.log("check-doc-freshness: OK（QUALITY_SCORE 数字与 GATES 清单均与代码一致）");
    return;
  }

  console.error(`check-doc-freshness: ${problems.length} 处文档漂移`);
  for (const p of problems) console.error("  - " + p);

  if (WRITE) {
    console.error("\n应用自动修复…");
    let applied = 0;
    for (const fix of fixes) {
      if (fix.manual) {
        console.error(`  ⊘ ${fix.what}：需人工处理 —— ${fix.manual}`);
        continue;
      }
      let text = fs.readFileSync(fix.file, "utf8");
      const before = text;
      text = text.replace(fix.from, fix.to);
      if (text !== before) {
        fs.writeFileSync(fix.file, text);
        console.error(`  ✓ ${fix.what} 已更新`);
        applied += 1;
      } else {
        console.error(`  ⊘ ${fix.what}：未匹配到待替换文本（可能文档结构已变）`);
      }
    }
    console.error(`\n已自动修复 ${applied} 处；剩余需人工处理的请按上方指引处理。`);
    // 修复后重跑校验，确认干净
    const r = spawnSync(process.execPath, [__filename], { cwd: REPO_ROOT, encoding: "utf8", stdio: "inherit" });
    process.exit(r.status === 0 ? 0 : 1);
  }

  console.error("\n修复指引：");
  console.error("  数字类漂移可自动修复：node scripts/check-doc-freshness.js --write");
  console.error("  清单类漂移需人工：按上方提示补登记或标注执行范围。");
  process.exit(1);
}

main();
