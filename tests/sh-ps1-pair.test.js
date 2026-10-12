const test = require("node:test");
const assert = require("node:assert");
const { spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-sh-ps1-pair.js");

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pair-"));
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "install.sh"), "v1\n");
  fs.writeFileSync(path.join(dir, "install.ps1"), "v1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  git(dir, "branch", "origin-main");
  return dir;
}

function run(dir, base) {
  return spawnSync("node", [SCRIPT, "--repo", dir, "--base", base || "origin-main"], { encoding: "utf8" });
}

function commitChange(dir, file, msg) {
  fs.appendFileSync(path.join(dir, file), "v2\n");
  git(dir, "add", file);
  git(dir, "commit", "-qm", msg);
}

test("sh-ps1-pair: 只改 install.sh 不改 install.ps1 必须失败", () => {
  const dir = makeRepo();
  try {
    commitChange(dir, "install.sh", "改一端");
    const r = run(dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /install\.ps1/);
    assert.match(r.stderr, /pair-exempt/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sh-ps1-pair: 两端成对变更通过", () => {
  const dir = makeRepo();
  try {
    commitChange(dir, "install.sh", "成对变更");
    commitChange(dir, "install.ps1", "成对变更");
    assert.strictEqual(run(dir).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sh-ps1-pair: commit message 含 pair-exempt 原因时放行", () => {
  const dir = makeRepo();
  try {
    commitChange(dir, "install.sh", "单端修复 pair-exempt: 仅 POSIX 路径问题");
    assert.strictEqual(run(dir).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sh-ps1-pair: 不相关文件变更不触发", () => {
  const dir = makeRepo();
  try {
    commitChange(dir, "README.md", "文档变更");
    assert.strictEqual(run(dir).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
