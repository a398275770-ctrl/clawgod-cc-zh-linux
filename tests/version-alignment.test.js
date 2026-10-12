const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-version-alignment.js");

function makeFixture(versions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ver-align-"));
  fs.mkdirSync(path.join(dir, "plugin", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "manifest.json"), JSON.stringify({ version: versions[0] }));
  fs.writeFileSync(path.join(dir, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ version: versions[1] }));
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), `# Changelog\n\n## [${versions[2]}] - 2026-10-10\n\n### 修复\n- x\n`);
  return dir;
}

function run(dir) {
  return spawnSync("node", [SCRIPT, "--root", dir], { encoding: "utf8" });
}

test("version-alignment: 当前仓库 3 处声明点一致", () => {
  const r = spawnSync("node", [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("version-alignment: 漂移时必须失败且报错含修复指引", () => {
  const dir = makeFixture(["2.23.0", "2.22.0", "2.23.0"]);
  try {
    const r = run(dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /plugin\.json = 2\.22\.0/);
    assert.match(r.stderr, /修复：/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("version-alignment: 缺失声明点时必须失败", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ver-align-"));
  try {
    const r = run(dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /缺失/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
