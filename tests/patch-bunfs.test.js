const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "patch-bunfs.js");
const TRANSLATIONS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "cli-translations.json"), "utf8")
);
// 选一条 en 为纯 ASCII、zh 含中文且与 en 不同的翻译做夹具（跳过恒等翻译与特殊引号条目）
const sample = TRANSLATIONS.find(
  (t) =>
    t && t.en && t.zh && t.zh !== t.en &&
    /[\u4e00-\u9fff]/.test(t.zh) &&
    /^[\x20-\x7e]+$/.test(t.en) &&
    !/["'\\]/.test(t.en)
);

function makeClawgodFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawgod-patch-"));
  fs.writeFileSync(path.join(dir, "cli.cjs"), "#!/usr/bin/env bun\n");
  fs.writeFileSync(path.join(dir, ".source-version"), "2.1.296\n");
  const bunfs = path.join(dir, "bunfs");
  fs.mkdirSync(bunfs, { recursive: true });
  // 含 UI 文案的 chunk（用真实翻译对构造）
  fs.writeFileSync(
    path.join(bunfs, "chunk-with-ui.js"),
    `const label = ${JSON.stringify(sample.en)};\nexport { label };\n`
  );
  // 不含 UI 文案的 chunk
  fs.writeFileSync(path.join(bunfs, "chunk-plain.js"), "export const x = 1;\n");
  return dir;
}

function run(dir, ...extra) {
  return spawnSync("node", [SCRIPT, path.join(dir, "bunfs"), ...extra], { encoding: "utf8" });
}

test("patch-bunfs: patch 含文案 chunk、备份原始文件、写标记、跳过的 chunk 无备份", () => {
  const dir = makeClawgodFixture();
  try {
    const original = fs.readFileSync(path.join(dir, "bunfs", "chunk-with-ui.js"), "utf8");
    const r = run(dir);
    assert.strictEqual(r.status, 0, r.stderr);

    const patched = fs.readFileSync(path.join(dir, "bunfs", "chunk-with-ui.js"), "utf8");
    assert.ok(/[\u4e00-\u9fff]/.test(patched), "应替换为中文");
    assert.ok(!patched.includes(sample.en), "英文原文应消失");

    const backup = fs.readFileSync(path.join(dir, "bunfs.zh-cn-backup", "chunk-with-ui.js"), "utf8");
    assert.strictEqual(backup, original, "备份必须与原始文件一致");

    assert.ok(!fs.existsSync(path.join(dir, "bunfs.zh-cn-backup", "chunk-plain.js")), "不含文案的 chunk 不应有备份");

    const marker = JSON.parse(fs.readFileSync(path.join(dir, ".zh-cn-patched"), "utf8"));
    assert.strictEqual(marker.version, "2.1.296");
    assert.strictEqual(marker.patched, 1);
    assert.ok(marker.revision, "标记应含 patch revision");

    // 语法校验：patch 结果必须是合法 JS
    const check = spawnSync(process.execPath, ["--check", path.join(dir, "bunfs", "chunk-with-ui.js")], { encoding: "utf8" });
    assert.strictEqual(check.status, 0, check.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("patch-bunfs: 重复 patch 幂等（同版本同 revision → noop）", () => {
  const dir = makeClawgodFixture();
  try {
    assert.strictEqual(run(dir).status, 0);
    const r2 = run(dir);
    assert.strictEqual(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /已是最新/);
    assert.match(r2.stdout, /"status":\s*"noop"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("patch-bunfs: --dry-run 不写任何文件", () => {
  const dir = makeClawgodFixture();
  try {
    const r = run(dir, "--dry-run");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, ".zh-cn-patched")), "dry-run 不应写标记");
    assert.ok(!fs.existsSync(path.join(dir, "bunfs.zh-cn-backup")), "dry-run 不应建备份");
    const after = fs.readFileSync(path.join(dir, "bunfs", "chunk-with-ui.js"), "utf8");
    assert.ok(after.includes(sample.en), "dry-run 不应改动 chunk");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("patch-bunfs: --restore 字节级还原并清理备份与标记", () => {
  const dir = makeClawgodFixture();
  try {
    const original = fs.readFileSync(path.join(dir, "bunfs", "chunk-with-ui.js"), "utf8");
    assert.strictEqual(run(dir).status, 0);
    assert.ok(/[\u4e00-\u9fff]/.test(fs.readFileSync(path.join(dir, "bunfs", "chunk-with-ui.js"), "utf8")));

    const r = spawnSync("node", [SCRIPT, "--restore", path.join(dir, "bunfs")], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readFileSync(path.join(dir, "bunfs", "chunk-with-ui.js"), "utf8"), original);
    assert.ok(!fs.existsSync(path.join(dir, "bunfs.zh-cn-backup")), "恢复后应删除备份目录");
    assert.ok(!fs.existsSync(path.join(dir, ".zh-cn-patched")), "恢复后应删除标记");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("patch-bunfs: 仅命中恒等翻译的 chunk 零改动且不产生备份", () => {
  const dir = makeClawgodFixture();
  try {
    // 找一个恒等翻译（en === zh）构造零改动 chunk
    const identity = TRANSLATIONS.find((t) => t && t.en && t.en === t.zh && /^[\x20-\x7e]+$/.test(t.en));
    assert.ok(identity, "翻译表中应存在恒等条目");
    fs.writeFileSync(
      path.join(dir, "bunfs", "chunk-identity.js"),
      `const x = ${JSON.stringify(identity.en)};\nexport { x };\n`
    );
    const r = run(dir);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(dir, "bunfs.zh-cn-backup", "chunk-identity.js")), "零改动 chunk 不应留下备份");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("patch-bunfs: bunfs 目录不存在时非零退出且报错含修复指引", () => {
  const r = spawnSync("node", [SCRIPT, "/tmp/definitely-not-exist-bunfs"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /修复：/);
});
