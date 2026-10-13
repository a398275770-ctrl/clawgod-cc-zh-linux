const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
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
  const f = path.join(mkTmpDir("lcov-"), "cov.info");
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

test("coverage-gate: 与根字节一致的 plugin/ 负载副本不双计（TD-QA-006）", () => {
  // patch-cli.js 在根与 plugin/ 各有一份且字节一致：两份都进报告时只能计一次
  const entries = entriesForKeyFiles(95);
  entries.push(["plugin/patch-cli.js", 100, Math.round(95)]);
  const r = run(makeLcov(entries));
  assert.strictEqual(r.status, 0, r.stderr);
  // 46 个真实源文件口径下不应出现 plugin 副本；报告行数只统计一次
  assert.doesNotMatch(r.stdout, /plugin\/patch-cli\.js: 行/);
});

test("coverage-gate: 低于 floor 下限的源文件必须失败并点名（TD-QA-007）", () => {
  const entries = entriesForKeyFiles(95);
  const floor = THRESHOLDS.floor.minLineRate;
  entries.push(["scripts/not-exempted.js", 100, Math.max(0, floor - 10)]);
  const r = run(makeLcov(entries));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /低于下限/);
  assert.match(r.stderr, /scripts\/not-exempted\.js/);
  assert.match(r.stderr, /floor\.exempt/);
});

test("coverage-gate: floor.exempt 登记的文件不因低覆盖失败", () => {
  const exemptFile = Object.keys(THRESHOLDS.floor.exempt)[0];
  const entries = entriesForKeyFiles(95);
  entries.push([exemptFile, 100, 5]); // 远低于 floor，但已登记豁免
  const r = run(makeLcov(entries));
  assert.strictEqual(r.status, 0, r.stderr);
});

test("coverage-gate: floor.exempt 到期后豁免自动失效", () => {
  // 改一个已过期的临时阈值文件，验证过期即恢复拦截
  const tmpThresholds = JSON.parse(JSON.stringify(THRESHOLDS));
  const exemptFile = Object.keys(tmpThresholds.floor.exempt)[0];
  tmpThresholds.floor.exempt[exemptFile].expires = "2020-01-01";
  const tmpDir = mkTmpDir("th-");
  // 脚本从自身所在目录读阈值，故把脚本+过期阈值复制到临时仓库结构再跑
  const tmpRepo = path.join(tmpDir, "repo");
  fs.mkdirSync(path.join(tmpRepo, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(tmpRepo, "scripts", "check-coverage.js"));
  fs.writeFileSync(path.join(tmpRepo, "scripts", "coverage-thresholds.json"), JSON.stringify(tmpThresholds));
  const entries = entriesForKeyFiles(95);
  entries.push([exemptFile, 100, 5]);
  const lcov = makeLcov(entries);
  const r = spawnSync("node", [path.join(tmpRepo, "scripts", "check-coverage.js"), "--lcov", lcov], {
    cwd: tmpRepo,
    encoding: "utf8",
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /豁免已过期/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
