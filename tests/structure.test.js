const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert");
const { spawnSync, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-structure.js");

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

function makeRepo(files) {
  const dir = mkTmpDir("struct-");
  git(dir, "init", "-q");
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
    git(dir, "add", name);
  }
  return dir;
}

function run(dir) {
  return spawnSync("node", [SCRIPT, "--root", dir], { encoding: "utf8" });
}

test("structure: 当前仓库通过 S1/S2", () => {
  const r = spawnSync("node", [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("structure S1: 安装脚本出现超长 heredoc 必须失败且报错含修复指引", () => {
  const heredoc = ["install.sh 内容", 'node <<\'NODE\'', ...Array(35).fill("// js"), "NODE"].join("\n");
  const dir = makeRepo({ "install.sh": heredoc });
  try {
    const r = run(dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /S1/);
    assert.match(r.stderr, /修复：/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("structure S1: 短 heredoc（≤30 行）放行", () => {
  const heredoc = ["x", 'node <<\'NODE\'', ...Array(10).fill("// js"), "NODE"].join("\n");
  const dir = makeRepo({ "install.sh": heredoc });
  try {
    assert.strictEqual(run(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("structure S2: require 逃逸仓库必须失败", () => {
  const dir = makeRepo({
    "scripts/bad.js": 'const x = require("../../outside.js");\nmodule.exports = x;\n',
  });
  try {
    const r = run(dir);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /S2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("structure S2: 仓库内相对 require 与内置模块放行", () => {
  const dir = makeRepo({
    "scripts/ok.js": 'const fs = require("fs");\nconst h = require("./helper.js");\nmodule.exports = h;\n',
    "scripts/helper.js": "module.exports = 1;\n",
  });
  try {
    assert.strictEqual(run(dir).status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
