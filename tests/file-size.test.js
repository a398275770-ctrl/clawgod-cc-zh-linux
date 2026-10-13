const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert");
const { spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-file-size.js");

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function makeRepo(files) {
  const dir = mkTmpDir("filesize-");
  git(dir, "init", "-q");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "gate-exemptions.json"), JSON.stringify({ exemptions: [] }));
  for (const [name, lines] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), Array(lines).fill("// x").join("\n") + "\n");
    git(dir, "add", name);
  }
  return dir;
}

function run(dir, ...extra) {
  return spawnSync("node", [SCRIPT, "--root", dir, ...extra], { encoding: "utf8" });
}

test("file-size: 当前仓库无超 2000 行文件", () => {
  const r = spawnSync("node", [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("file-size: 超限文件必须失败且报错含修复指引", () => {
  const dir = makeRepo({ "big.js": 2100, "small.js": 10 });
  try {
    const r = run(dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /big\.js: 2100 行/);
    assert.doesNotMatch(r.stderr, /small\.js/);
    assert.match(r.stderr, /修复：/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("file-size: 登记有效豁免后放行，过期豁免失效", () => {
  const dir = makeRepo({ "big.js": 2100 });
  const exFile = path.join(dir, "scripts", "gate-exemptions.json");
  try {
    fs.writeFileSync(exFile, JSON.stringify({ exemptions: [
      { check: "file-size", path: "big.js", reason: "测试豁免", expires: "2999-01-01" },
    ] }));
    assert.strictEqual(run(dir).status, 0, "有效豁免应放行");

    fs.writeFileSync(exFile, JSON.stringify({ exemptions: [
      { check: "file-size", path: "big.js", reason: "已过期", expires: "2020-01-01" },
    ] }));
    assert.notStrictEqual(run(dir).status, 0, "过期豁免应失效");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
