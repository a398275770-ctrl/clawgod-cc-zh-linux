const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const hookPath = path.join(repoRoot, "plugin", "hooks", "session-start");
const TRANSLATIONS = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "cli-translations.json"), "utf8")
);
const sample = TRANSLATIONS.find(
  (t) =>
    t && t.en && t.zh && t.zh !== t.en &&
    /[一-鿿]/.test(t.zh) &&
    /^[\x20-\x7e]+$/.test(t.en) &&
    !/["'\\]/.test(t.en)
);

function copyTree(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyTree(path.join(src, entry), path.join(dst, entry));
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function createContext(t) {
  const tmp = mkTmpDir("cczh-clawgod-hook-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, "home");
  const clawgodDir = path.join(tmp, "clawgod");
  const pluginRoot = path.join(tmp, "plugin");
  const fakeBin = path.join(tmp, "bin");

  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ theme: "dark" }, null, 2) + "\n"
  );

  fs.mkdirSync(path.join(clawgodDir, "bunfs"), { recursive: true });
  fs.writeFileSync(path.join(clawgodDir, "cli.cjs"), "#!/usr/bin/env bun\n");
  fs.writeFileSync(path.join(clawgodDir, ".source-version"), "2.1.296\n");
  fs.writeFileSync(
    path.join(clawgodDir, "bunfs", "chunk-ui.js"),
    `const label = ${JSON.stringify(sample.en)};\nexport { label };\n`
  );

  copyTree(path.join(repoRoot, "plugin"), pluginRoot);

  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeClaude = path.join(fakeBin, "claude");
  fs.writeFileSync(fakeClaude, "#!/usr/bin/env bash\nprintf '2.1.296 (Claude Code)\\n'\n", { mode: 0o755 });

  return {
    tmp, home, clawgodDir, pluginRoot,
    env: {
      ...process.env,
      HOME: home,
      CLAWGOD_DIR: clawgodDir,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      PATH: `${fakeBin}:${process.env.PATH}`,
      ZH_CN_UPDATE_CHECK_INTERVAL_SECONDS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    run() {
      return spawnSync("bash", [hookPath], {
        cwd: repoRoot, env: this.env, input: "\n", encoding: "utf8",
      });
    },
  };
}

test("session-start: 检测到 clawgod 时自动 patch bunfs 并在上下文中提示", { skip: process.platform === "win32" ? "covered by Windows CI" : false }, (t) => {
  const ctx = createContext(t);
  const result = ctx.run();
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const output = JSON.parse(result.stdout);
  const contextText = output.hookSpecificOutput.additionalContext;
  assert.match(contextText, /clawgod bunfs/);

  const patched = fs.readFileSync(path.join(ctx.clawgodDir, "bunfs", "chunk-ui.js"), "utf8");
  assert.ok(/[一-鿿]/.test(patched), "chunk 应被汉化");
  assert.ok(fs.existsSync(path.join(ctx.clawgodDir, ".zh-cn-patched")), "应写入 clawgod 标记");

  // 二次运行：幂等，不再重复 patch
  const again = ctx.run();
  assert.equal(again.status, 0, again.stderr || again.stdout);
  const againText = JSON.parse(again.stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(againText, /已自动 patch clawgod bunfs \d+ 个 chunk/);
});

test("session-start: 无 clawgod 环境时不产生 clawgod 提示", { skip: process.platform === "win32" ? "covered by Windows CI" : false }, (t) => {
  const ctx = createContext(t);
  fs.rmSync(ctx.clawgodDir, { recursive: true, force: true });
  const result = ctx.run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const contextText = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(contextText, /clawgod bunfs/);
});
