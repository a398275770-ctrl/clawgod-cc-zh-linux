const test = require("node:test");
const { mkTmpDir } = require("./helpers/tmpdir.js");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const unixShellRequired = process.platform === "win32" ? "covered by Unix CI" : false;
const sqlite3Available = (() => {
  try { execFileSync("sqlite3", ["--version"]); return false; } catch { return "sqlite3 not available"; }
})();

function createFakeClaude(tmp, pluginVersion) {
  const binDir = path.join(tmp, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const cli = path.join(binDir, "claude");
  fs.writeFileSync(
    cli,
    `#!/usr/bin/env bash
set -u
if [ "\${1:-}" = "plugin" ] && [ "\${2:-}" = "marketplace" ] && [ "\${3:-}" = "list" ]; then
  printf '%s\\n' '[{"name":"claude-code-zh-cn","source":"directory"}]'
  exit 0
fi
if [ "\${1:-}" = "plugin" ] && [ "\${2:-}" = "list" ]; then
  printf '%s\\n' '[{"id":"claude-code-zh-cn@claude-code-zh-cn","scope":"user","enabled":true,"version":"${pluginVersion}"}]'
  exit 0
fi
if [ "\${1:-}" = "plugin" ]; then exit 0; fi
printf '2.23.0 (Claude Code)\\n'
`,
    { mode: 0o755 }
  );
  return cli;
}

function createInstallSource(tmp) {
  const source = path.join(tmp, "source");
  for (const relative of [
    "install.sh",
    "compute-patch-revision.sh",
    "settings-overlay.json",
    ".claude-plugin",
    "plugin",
    "scripts",
    "tips",
    "verbs",
  ]) {
    fs.cpSync(path.join(repoRoot, relative), path.join(source, relative), { recursive: true });
  }
  return source;
}

function createCcSwitchDb(home, commonConfig) {
  const dir = path.join(home, ".cc-switch");
  fs.mkdirSync(dir, { recursive: true });
  const db = path.join(dir, "cc-switch.db");
  execFileSync("sqlite3", [db, "create table settings(key text primary key, value text); create table providers(id text, meta text, app_type text);"]);
  execFileSync("sqlite3", [db, `insert into settings values('common_config_claude', '${commonConfig.replace(/'/g, "''")}');`]);
  execFileSync("sqlite3", [db, `insert into providers values('prov-1', '{}', 'claude');`]);
  return db;
}

function createContext(t, commonConfig) {
  const tmp = mkTmpDir("cczh-ccswitch-");
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const pluginVersion = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "plugin", ".claude-plugin", "plugin.json"), "utf8")
  ).version;
  const fakeCli = createFakeClaude(tmp, pluginVersion);
  const source = createInstallSource(tmp);
  const db = createCcSwitchDb(home, commonConfig);
  return {
    tmp,
    db,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${path.dirname(fakeCli)}:${process.env.PATH || ""}`,
      ZH_CN_REAL_CLAUDE: fakeCli,
      ZH_CN_SKIP_BANNER: "1",
      ZH_CN_LAUNCHER_BIN_DIR: path.join(home, ".claude", "bin"),
      ZH_CN_PROFILE_FILES: path.join(home, ".bashrc"),
      CLAUDE_PLUGIN_ROOT: path.join(home, ".claude", "plugins", "claude-code-zh-cn"),
      GIT_TERMINAL_PROMPT: "0",
    },
    runInstall(extraEnv = {}) {
      return spawnSync("/bin/bash", [path.join(source, "install.sh")], {
        cwd: source,
        env: { ...this.env, ...extraEnv },
        encoding: "utf8",
      });
    },
    query(sql) {
      return execFileSync("sqlite3", [this.db, sql], { encoding: "utf8" }).trim();
    },
  };
}

test("ccswitch sync: 用户同意后合并中文配置并更新 provider meta，且创建数据库备份", { skip: unixShellRequired || sqlite3Available }, (t) => {
  const ctx = createContext(t, '{"language":"English"}');
  const result = ctx.runInstall({ ZH_CN_CCSWITCH_SYNC: "1" });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);

  const merged = JSON.parse(ctx.query("select value from settings where key='common_config_claude';"));
  assert.equal(merged.language, "Chinese", "同意後应写入中文配置");
  const meta = JSON.parse(ctx.query("select meta from providers where id='prov-1';"));
  assert.equal(meta.commonConfigEnabled, true, "provider meta 应标记 commonConfigEnabled");
  const backups = fs.readdirSync(path.dirname(ctx.db)).filter((f) => f.startsWith("cc-switch.db.zh-cn-backup."));
  assert.ok(backups.length >= 1, "应创建数据库备份");
});

test("ccswitch sync: 无授权且非交互时不修改通用配置", { skip: unixShellRequired || sqlite3Available }, (t) => {
  const ctx = createContext(t, '{"language":"English"}');
  const result = ctx.runInstall({ ZH_CN_CCSWITCH_SYNC: "0" });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);

  const current = JSON.parse(ctx.query("select value from settings where key='common_config_claude';"));
  assert.equal(current.language, "English", "未授权不得改动通用配置");
});

test("ccswitch sync: 已是完整中文配置且无需 provider 更新时不改动、不报错", { skip: unixShellRequired || sqlite3Available }, (t) => {
  const complete = JSON.stringify({
    language: "Chinese",
    spinnerTipsEnabled: true,
    spinnerVerbs: { verbs: Array(120).fill("x") },
    spinnerTipsOverride: { tips: Array(45).fill("y") },
  });
  const ctx = createContext(t, complete);
  execFileSync("sqlite3", [ctx.db, "update providers set meta='{\"commonConfigEnabled\":true}';"]);
  const before = ctx.query("select value from settings where key='common_config_claude';");
  const result = ctx.runInstall({ ZH_CN_CCSWITCH_SYNC: "1" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(ctx.query("select value from settings where key='common_config_claude';"), before, "已同步时应原样保留");
});
