const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "migrate-tmpdir.js");

/**
 * migrate-tmpdir.js 的门禁守护。
 *
 * 防的是「守卫自己被改窄」：2026-10-13 首版正则只匹配字符串/模板字面量，
 * 漏掉标识符形态（mkdtempSync(path.join(os.tmpdir(), name))），
 * 导致 tests/install-json-helper.test.js 的 3 个泄漏目录长期无人发现。
 * 这些用例锁定「两种前缀形态都必须被抓住且可自动迁移」。
 */

function makeRepo() {
  const dir = mkTmpDir("migrate-");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", "migrate-tmpdir.js"));
  return dir;
}

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
}

function writeTest(dir, body) {
  const f = path.join(dir, "tests", "sample.test.js");
  fs.writeFileSync(
    f,
    [
      'const fs = require("node:fs");',
      'const os = require("node:os");',
      'const path = require("node:path");',
      "",
      body,
    ].join("\n")
  );
  return f;
}

function run(dir, args = []) {
  return execFileSync("node", [path.join(dir, "scripts", "migrate-tmpdir.js"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_DIR: undefined },
  });
}

function runCapture(dir, args = []) {
  const { spawnSync } = require("node:child_process");
  return spawnSync("node", [path.join(dir, "scripts", "migrate-tmpdir.js"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env },
  });
}

test("migrate-tmpdir: 字符串字面量形态被抓住且可自动迁移", (t) => {
  const dir = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeTest(dir, 'const d = fs.mkdtempSync(path.join(os.tmpdir(), "cczh-x-"));');
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const r = runCapture(dir, ["--check"]);
  assert.notStrictEqual(r.status, 0, "字符串字面量形态必须被 --check 抓住");
  assert.match(r.stdout, /替换 1 处/);

  run(dir);
  const after = fs.readFileSync(path.join(dir, "tests", "sample.test.js"), "utf8");
  assert.match(after, /mkTmpDir\("cczh-x-"\)/);
  assert.doesNotMatch(after, /fs\.mkdtempSync/);
  assert.match(after, /require\("\.\/helpers\/tmpdir\.js"\)/);
});

test("migrate-tmpdir: 标识符形态（变量前缀）也必须被抓住——2026-10-13 首版漏检", (t) => {
  const dir = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 这正是 tests/install-json-helper.test.js 的包装函数形态，首版正则匹配不到
  writeTest(dir, "function tmpDir(name) {\n  return fs.mkdtempSync(path.join(os.tmpdir(), name));\n}");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const r = runCapture(dir, ["--check"]);
  assert.notStrictEqual(r.status, 0, "标识符形态必须被抓住（这是本次扩展的全部意义）");
  assert.match(r.stdout, /替换 1 处/);

  run(dir);
  const after = fs.readFileSync(path.join(dir, "tests", "sample.test.js"), "utf8");
  assert.match(after, /mkTmpDir\(name\)/);
  assert.doesNotMatch(after, /fs\.mkdtempSync/);
});

test("migrate-tmpdir: 模板字面量形态（含 ${...}）被抓住且保留表达式", (t) => {
  const dir = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeTest(dir, "const d = fs.mkdtempSync(path.join(os.tmpdir(), `cczh-${name}-`));");
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const r = runCapture(dir, ["--check"]);
  assert.notStrictEqual(r.status, 0);
  run(dir);
  const after = fs.readFileSync(path.join(dir, "tests", "sample.test.js"), "utf8");
  assert.match(after, /mkTmpDir\(`cczh-\$\{name\}-`\)/);
});

test("migrate-tmpdir: 已全部迁移的仓库 --check 通过", (t) => {
  const dir = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeTest(dir, 'const { mkTmpDir } = require("./helpers/tmpdir.js");\nconst d = mkTmpDir("cczh-x-");');
  git(dir, "add", "-A");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const r = runCapture(dir, ["--check"]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /替换 0 处/);
});
