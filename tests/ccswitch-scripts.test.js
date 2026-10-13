const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const STATUS_SCRIPT = path.join(REPO_ROOT, "scripts", "ccswitch-config-status.js");
const MERGE_SCRIPT = path.join(REPO_ROOT, "scripts", "ccswitch-build-merged-config.js");
const PROVIDER_SCRIPT = path.join(REPO_ROOT, "scripts", "ccswitch-build-provider-meta-updates.js");

function tmpdir() {
  return mkTmpDir("ccsw-");
}

function writeJson(dir, name, value) {
  const p = path.join(dir, name);
  if (typeof value === "string") fs.writeFileSync(p, value);
  else fs.writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------- ccswitch-config-status.js ----------

function runStatus(current, overlay) {
  const dir = tmpdir();
  try {
    const cur = writeJson(dir, "cur.json", current);
    const ovl = writeJson(dir, "ovl.json", overlay || {});
    return spawnSync("node", [STATUS_SCRIPT], {
      env: { ...process.env, ZH_CN_CCSWITCH_CURRENT_FILE: cur, ZH_CN_CCSWITCH_OVERLAY_FILE: ovl },
      encoding: "utf8",
    }).stdout;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("ccswitch-config-status: 完整中文配置 → ok", () => {
  const current = {
    language: "Chinese",
    spinnerTipsEnabled: true,
    spinnerVerbs: { verbs: Array(120).fill("x") },
    spinnerTipsOverride: { tips: Array(45).fill("y") },
  };
  assert.strictEqual(runStatus(current), "ok");
});

test("ccswitch-config-status: 缺中文设置 → needs-sync", () => {
  assert.strictEqual(runStatus({ language: "English" }), "needs-sync");
  assert.strictEqual(runStatus({}), "needs-sync");
});

test("ccswitch-config-status: 可解析但非对象 → invalid", () => {
  assert.strictEqual(runStatus("[1,2]"), "invalid");
});

test("ccswitch-config-status: 非法 JSON → 非零退出（invalid 由调用方兜底输出，与 heredoc 原行为一致）", () => {
  const dir = tmpdir();
  try {
    const cur = writeJson(dir, "cur.json", "{not json");
    const ovl = writeJson(dir, "ovl.json", {});
    const r = spawnSync("node", [STATUS_SCRIPT], {
      env: { ...process.env, ZH_CN_CCSWITCH_CURRENT_FILE: cur, ZH_CN_CCSWITCH_OVERLAY_FILE: ovl },
      encoding: "utf8",
    });
    assert.notStrictEqual(r.status, 0);
    assert.strictEqual(r.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- ccswitch-build-merged-config.js ----------

test("ccswitch-build-merged-config: 深合并且保留 base 独有键", () => {
  const dir = tmpdir();
  try {
    const cur = writeJson(dir, "cur.json", { a: 1, nested: { keep: true, change: "old" } });
    const ovl = writeJson(dir, "ovl.json", { b: 2, nested: { change: "new" } });
    const out = path.join(dir, "out.json");
    const r = spawnSync("node", [MERGE_SCRIPT], {
      env: { ...process.env, ZH_CN_CCSWITCH_CURRENT_FILE: cur, ZH_CN_CCSWITCH_OVERLAY_FILE: ovl, ZH_CN_CCSWITCH_OUTPUT_FILE: out },
      encoding: "utf8",
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, "utf8")), {
      a: 1, b: 2, nested: { keep: true, change: "new" },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ccswitch-build-merged-config: overlay 非对象 → exit 2 且不写文件", () => {
  const dir = tmpdir();
  try {
    const cur = writeJson(dir, "cur.json", { a: 1 });
    const ovl = writeJson(dir, "ovl.json", "[1,2]");
    const out = path.join(dir, "out.json");
    const r = spawnSync("node", [MERGE_SCRIPT], {
      env: { ...process.env, ZH_CN_CCSWITCH_CURRENT_FILE: cur, ZH_CN_CCSWITCH_OVERLAY_FILE: ovl, ZH_CN_CCSWITCH_OUTPUT_FILE: out },
      encoding: "utf8",
    });
    assert.strictEqual(r.status, 2);
    assert.ok(!fs.existsSync(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- ccswitch-build-provider-meta-updates.js ----------

function hex(s) {
  return Buffer.from(s, "utf8").toString("hex");
}

test("ccswitch-provider-meta-updates: 生成 SQL、计数正确、单引号转义", () => {
  const dir = tmpdir();
  try {
    const lines = [
      `${hex("id-1")}\t${hex(JSON.stringify({}))}`,
      `${hex("id'2")}\t${hex(JSON.stringify({ commonConfigEnabled: true }))}`,
      `${hex("bad")}\t${hex("{invalid")}`,
    ].join("\n");
    const providers = path.join(dir, "providers.txt");
    fs.writeFileSync(providers, lines);
    const sql = path.join(dir, "out.sql");
    const r = spawnSync("node", [PROVIDER_SCRIPT], {
      env: { ...process.env, ZH_CN_CCSWITCH_PROVIDERS_FILE: providers, ZH_CN_CCSWITCH_PROVIDER_SQL_FILE: sql },
      encoding: "utf8",
    });
    assert.strictEqual(r.status, 0, r.stderr);
    // changed=2（两条有效且仅一条需改）… 实际：第一条需改、第二条已是 true → changed=1；第三条 skip
    assert.strictEqual(r.stdout.trim(), "1 3 1");
    const content = fs.readFileSync(sql, "utf8");
    assert.match(content, /update providers set meta=.*commonConfigEnabled.*where id='id-1'/);
    assert.match(content, /'id''2'/, "单引号必须转义为 ''");
    assert.ok(!content.includes("bad"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
