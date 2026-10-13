const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-doc-freshness.js");

/**
 * 文档园丁的门禁守护。
 *
 * 这些用例验证的是「门禁本身有效」——即园丁能在文档漂移时失败、在一致时通过、
 * 且 --write 只改目标行。防的是「假测试」：一个永远 exit 0 的检查比没有更糟。
 *
 * 做法：把 QUALITY_SCORE.md / GATES.md 复制到临时仓库结构，注入漂移后跑脚本，
 * 不碰真实文档（也避免触发昂贵的全量测试重跑——脚本内部会跑 node --test，
 * 故这里只测解析与判定逻辑，用 --skip-truth 跳过真相现算）。
 */

function makeTempRepo({ qualityScore, gates }) {
  const dir = mkTmpDir("freshness-");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", "check-doc-freshness.js"));
  if (qualityScore !== undefined) {
    fs.writeFileSync(path.join(dir, "docs", "QUALITY_SCORE.md"), qualityScore);
  }
  if (gates !== undefined) {
    fs.writeFileSync(path.join(dir, "docs", "GATES.md"), gates);
  }
  return dir;
}

function run(dir, args = []) {
  return spawnSync(process.execPath, [path.join(dir, "scripts", "check-doc-freshness.js"), ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
  });
}

const CLEAN_SCORE = [
  "## 评分依据",
  "",
  "- **测试基线**：`node --test tests/` → 549 用例 / 538 通过。",
  "- **复杂度**：`install.sh` 1360 行。",
  "  - **真实口径**（剔除副本）：行 **85.54%**（12276/14351）。",
].join("\n");

const CLEAN_GATES = [
  "| 检查 | 入口 | 触发 |",
  "|---|---|---|",
  "| 文档死链 | `node scripts/check-doc-links.js` | CI + check-all |",
  "| 文件大小 | `node scripts/check-file-size.js` | CI + check-all |",
].join("\n");

test("doc-freshness: 真相来源不可用（临时仓库无 tests/）必须失败并给修复指引", (t) => {
  const dir = makeTempRepo({
    qualityScore: CLEAN_SCORE,
    gates: CLEAN_GATES,
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  // 临时仓库没有 tests/ 与真实源码，countTests 会失败——这正说明脚本不假装通过
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /无法解析|修复：/);
});

test("doc-freshness: 文档缺失时给出可执行的修复指引而非裸崩", (t) => {
  const dir = makeTempRepo({}); // 两个文档都不建
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.notStrictEqual(r.status, 0);
  // 不能是 ENOENT 堆栈，必须是带「修复：」的明确指引
  assert.doesNotMatch(r.stderr, /ENOENT/);
  assert.match(r.stderr, /修复：/);
});

test("doc-freshness: --write 只改「真实口径」行，不碰其他口径叙述", (t) => {
  const dir = makeTempRepo({
    qualityScore: [
      "## 评分依据",
      "  - 门禁当前口径（含副本，51 文件）：整体行 79.92%（13167/16476）。",
      "  - **真实口径**（剔除副本，48 文件）：行 **11.11%**（12276/14351）。",
    ].join("\n"),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 手动构造：把脚本里的真相来源换成桩，避免跑全量测试
  const script = fs.readFileSync(path.join(dir, "scripts", "check-doc-freshness.js"), "utf8");
  const stubbed = script.replace(
    /function countTests\(\) \{[\s\S]*?\n\}/,
    `function countTests() { return 549; }`
  ).replace(
    /function readCoverage\(\) \{[\s\S]*?\n\}/,
    `function readCoverage() { return { lines: "85.54", branches: "70.16", functions: "79.43", fileCount: 48 }; }`
  ).replace(
    /function countLines\(file\) \{[\s\S]*?\n\}/,
    `function countLines(file) { return { "install.sh": 1360, "install.ps1": 1382, "patch-cli.js": 1135 }[file] ?? 0; }`
  ).replace(
    /function maxFunctionLines\(file\) \{[\s\S]*?\n\}/,
    `function maxFunctionLines(file) { return { n: 61, name: "ccswitch_sync_apply()" }; }`
  ).replace(
    /function checkAllSteps\(\) \{[\s\S]*?\n\}/,
    `function checkAllSteps() { return new Set(); }`
  );
  assert.notStrictEqual(script, stubbed, "桩替换失败——脚本结构可能已变，需更新本测试");
  fs.writeFileSync(path.join(dir, "scripts", "check-doc-freshness.js"), stubbed);

  const r = run(dir, ["--write"]);
  const after = fs.readFileSync(path.join(dir, "docs", "QUALITY_SCORE.md"), "utf8");
  // 关键断言：79.92% 那行必须原样保留，只有 11.11% 被改成 85.54%
  assert.match(after, /整体行 79\.92%（13167\/16476）/);
  assert.doesNotMatch(after, /11\.11/);
  assert.match(after, /行 \*\*85\.54%\*\*/);
  assert.strictEqual(r.status, 0, r.stderr);
});

test("doc-freshness: 门禁清单与 check-all 步骤不符时必须失败", (t) => {
  const dir = makeTempRepo({
    qualityScore: CLEAN_SCORE,
    gates: [
      "| 检查 | 入口 | 触发 |",
      "|---|---|---|",
      "| 文档死链 | `node scripts/check-doc-links.js` | CI + check-all |",
    ].join("\n"),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = fs.readFileSync(path.join(dir, "scripts", "check-doc-freshness.js"), "utf8");
  const stubbed = script
    .replace(/function countTests\(\) \{[\s\S]*?\n\}/, `function countTests() { return 549; }`)
    .replace(/function readCoverage\(\) \{[\s\S]*?\n\}/, `function readCoverage() { return { lines: "85.54", branches: "70.16", functions: "79.43", fileCount: 48 }; }`)
    .replace(/function countLines\(file\) \{[\s\S]*?\n\}/, `function countLines(file) { return 1360; }`)
    .replace(/function maxFunctionLines\(file\) \{[\s\S]*?\n\}/, `function maxFunctionLines(file) { return { n: 61, name: "f()" }; }`)
    // checkAllSteps 读真实 check-all.sh：临时仓库里造一个假的
    ;
  fs.writeFileSync(path.join(dir, "scripts", "check-doc-freshness.js"), stubbed);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "scripts", "check-all.sh"),
    'run "x" node scripts/check-doc-links.js\nrun "y" node scripts/check-file-size.js\nrun "z" node scripts/check-structure.js\n'
  );

  const r = run(dir);
  assert.notStrictEqual(r.status, 0, "GATES 漏登 check-structure 时必须失败");
  assert.match(r.stderr, /未登记/);
  assert.match(r.stderr, /check-structure\.js/);
});
