const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-coverage.js");
const THRESHOLDS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "scripts", "coverage-thresholds.json"), "utf8")
);

function lcovEntry(sf, lf, lh) {
  return `TN:\nSF:${sf}\nLF:${lf}\nLH:${lh}\nBRF:0\nBRH:0\nFNF:0\nFNH:0\nend_of_record\n`;
}

function makeLcov(entries) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lcov-")), "cov.info");
  fs.writeFileSync(f, entries.map(([sf, lf, lh]) => lcovEntry(sf, lf, lh)).join(""));
  return f;
}

function run(lcovFile) {
  return spawnSync("node", [SCRIPT, "--lcov", lcovFile], { cwd: REPO_ROOT, encoding: "utf8" });
}

function entriesForKeyFiles(rate) {
  // 生成覆盖全部 keyFiles + 一个普通文件、且整体达标的 lcov
  const entries = Object.keys(THRESHOLDS.keyFiles).map((f) => [f, 100, Math.round(rate)]);
  entries.push(["scripts/some-other.js", 100, Math.round(rate)]);
  return entries;
}

test("coverage-gate: 达标报告通过", () => {
  const f = makeLcov(entriesForKeyFiles(95));
  const r = run(f);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-coverage: OK/);
});

test("coverage-gate: 整体行覆盖低于下限必须失败且报错含修复指引", () => {
  // 普通文件 0% 拉低整体，keyFiles 保持高位
  const entries = Object.keys(THRESHOLDS.keyFiles).map((f) => [f, 100, 100]);
  for (let i = 0; i < 6; i++) entries.push([`scripts/uncovered-${i}.js`, 100, 0]);
  const r = run(makeLcov(entries));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /整体行覆盖/);
  assert.match(r.stderr, /修复：/);
});

test("coverage-gate: 关键模块低于下限必须失败并点名模块", () => {
  const weakest = Object.entries(THRESHOLDS.keyFiles)[0];
  const entries = entriesForKeyFiles(100).map(([sf, lf, lh]) =>
    sf === weakest[0] ? [sf, 100, 0] : [sf, lf, lh]
  );
  const r = run(makeLcov(entries));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(weakest[0].replace(/[./]/g, "\\$&")));
});

test("coverage-gate: 关键模块缺失（测试未加载）必须失败", () => {
  const entries = [["scripts/some-other.js", 100, 95]];
  const r = run(makeLcov(entries));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /未出现在覆盖率报告中/);
});

test("coverage-gate: 仅含 fixture 路径（../ 开头）视为无有效数据", () => {
  const r = run(makeLcov([["../../tmp/cczh-x/plugin/patch-cli.js", 100, 100]]));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /未解析到任何仓库内源码文件/);
});

test("coverage-gate: tests/ 目录不计入源码统计", () => {
  const entries = entriesForKeyFiles(95);
  entries.push(["tests/some.test.js", 100, 0]);
  const r = run(makeLcov(entries));
  assert.strictEqual(r.status, 0, r.stderr);
});
