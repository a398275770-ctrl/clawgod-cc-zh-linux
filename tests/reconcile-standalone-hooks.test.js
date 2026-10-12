const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "reconcile-standalone-hooks.js");
const PLUGIN_ID = "claude-code-zh-cn@claude-code-zh-cn";
const PLUGIN_DST = "/home/x/.claude/plugins/claude-code-zh-cn";

function run(settingsValue, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recon-"));
  try {
    const settingsFile = path.join(dir, "settings.json");
    fs.writeFileSync(settingsFile, typeof settingsValue === "string" ? settingsValue : JSON.stringify(settingsValue));
    const r = spawnSync("node", [SCRIPT], {
      env: {
        ...process.env,
        ZH_CN_SETTINGS: settingsFile,
        ZH_CN_PLUGIN_DST: PLUGIN_DST,
        ZH_CN_PLUGIN_RUNTIME_MODE: mode,
        ZH_CN_OFFICIAL_PLUGIN_ID: PLUGIN_ID,
      },
      encoding: "utf8",
    });
    const after = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : null;
    return { status: r.status, after: after ? JSON.parse(after) : null };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("standalone 模式：写入三类备用 Hook 并停用官方入口", () => {
  const { status, after } = run({}, "standalone");
  assert.strictEqual(status, 0);
  assert.strictEqual(after.enabledPlugins[PLUGIN_ID], false);
  for (const event of ["SessionStart", "Notification", "UserPromptSubmit"]) {
    assert.ok(Array.isArray(after.hooks[event]), `${event} 应存在`);
    assert.strictEqual(after.hooks[event][0].hooks[0].args[1], "--standalone");
  }
});

test("standalone 模式幂等：重复运行先清理旧 standalone hook 再写入，不产生重复", () => {
  const once = run({}, "standalone");
  const twice = run(once.after, "standalone");
  assert.strictEqual(twice.status, 0);
  const count = twice.after.hooks.SessionStart[0].hooks.length;
  assert.strictEqual(count, 1, `SessionStart 应只有 1 个 hook，实际 ${count}`);
});

test("official-retry 模式：重新启用官方入口，且清理 standalone hook", () => {
  const once = run({}, "standalone");
  const retry = run(once.after, "official-retry");
  assert.strictEqual(retry.status, 0);
  assert.strictEqual(retry.after.enabledPlugins[PLUGIN_ID], true);
  assert.ok(!retry.after.hooks || !retry.after.hooks.SessionStart, "standalone hook 应被清理");
});

test("非 standalone/retry 模式：只清理 standalone hook，不动 enabledPlugins", () => {
  const once = run({}, "standalone");
  const clean = run(once.after, "official");
  assert.strictEqual(clean.status, 0);
  assert.strictEqual(clean.after.enabledPlugins[PLUGIN_ID], false, "不应改动 enabledPlugins");
  assert.ok(!clean.after.hooks || !clean.after.hooks.SessionStart);
});

test("settings 非法（非对象）→ exit 2", () => {
  const { status } = run("[1,2]", "standalone");
  assert.strictEqual(status, 2);
});
