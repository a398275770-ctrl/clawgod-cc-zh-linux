const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "detect-clawgod.js");

function makeLayout({ cliCjs = true, chunks = ["chunk-abc123.js"], sourceVersion = "2.1.296" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawgod-detect-"));
  if (cliCjs) fs.writeFileSync(path.join(dir, "cli.cjs"), "#!/usr/bin/env bun\n");
  const bunfs = path.join(dir, "bunfs");
  fs.mkdirSync(bunfs, { recursive: true });
  for (const c of chunks) fs.writeFileSync(path.join(bunfs, c), "// chunk\n");
  if (sourceVersion) fs.writeFileSync(path.join(dir, ".source-version"), sourceVersion + "\n");
  return dir;
}

function run(dir) {
  return spawnSync("node", [SCRIPT], {
    env: { ...process.env, CLAWGOD_DIR: dir },
    encoding: "utf8",
  });
}

test("detect-clawgod: 完整布局命中，输出 clawgod-bunfs:<bunfs>", () => {
  const dir = makeLayout();
  try {
    const r = run(dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, "clawgod-bunfs:" + path.join(dir, "bunfs"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detect-clawgod: 缺 cli.cjs 不命中", () => {
  const dir = makeLayout({ cliCjs: false });
  try {
    const r = run(dir);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detect-clawgod: 无 chunk 不命中", () => {
  const dir = makeLayout({ chunks: [] });
  try {
    assert.strictEqual(run(dir).stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detect-clawgod: bunfs 不是目录不命中", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawgod-detect-"));
  try {
    fs.writeFileSync(path.join(dir, "cli.cjs"), "x");
    fs.writeFileSync(path.join(dir, "bunfs"), "i am a file");
    assert.strictEqual(run(dir).stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detect-clawgod: CLAWGOD_DIR 未设置时探测 ~/.clawgod（本机真实环境应命中或不命中都不报错）", () => {
  const env = { ...process.env };
  delete env.CLAWGOD_DIR;
  const r = spawnSync("node", [SCRIPT], { env, encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  // 只验证不崩溃；输出取决于运行环境
});
