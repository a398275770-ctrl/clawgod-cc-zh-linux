#!/usr/bin/env node
/**
 * patch-bunfs.js — clawgod bunfs 形态的 UI 文字 patch / 恢复（批次 A/B，决策 D7=默认开启）
 *
 * 复用 patch-cli.js 引擎逐 chunk 替换（spawn，不 require——它是带顶层执行的脚本）。
 * 通过"是否含任一英文 needle"预筛，绝大多数不含 UI 文案的 chunk 直接跳过。
 *
 * 用法：
 *   node scripts/patch-bunfs.js <bunfsDir>            # patch（幂等：标记含版本+revision）
 *   node scripts/patch-bunfs.js <bunfsDir> --dry-run  # 只统计，不写任何文件
 *   node scripts/patch-bunfs.js --restore <bunfsDir>  # 从备份恢复全部 chunk
 *
 * 契约（core-beliefs #17：CLI 永远可用）：
 *   - 每 chunk 独立：备份 → patch → node --check 语法校验 → 失败仅回滚该 chunk
 *   - 标记文件 $CLAWGOD_DIR/.zh-cn-patched（JSON：version/revision/patched/failed）
 *   - 退出码：0 成功（含部分降级）；2 存在失败 chunk（已回滚，部分汉化）
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const restoreMode = args.includes("--restore");
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const bunfsDir = path.resolve(positional[0] || "");

const REPO_ROOT = path.resolve(__dirname, "..");
const PATCH_CLI = path.join(REPO_ROOT, "patch-cli.js");
const TRANSLATIONS = path.join(REPO_ROOT, "cli-translations.json");
const COMPUTE_REVISION = path.join(REPO_ROOT, "compute-patch-revision.sh");

function fail(msg) {
  console.error("patch-bunfs: " + msg);
  process.exit(2);
}

if (!bunfsDir || !fs.existsSync(path.join(bunfsDir)) || !fs.statSync(bunfsDir).isDirectory()) {
  fail(`bunfs 目录不存在：${bunfsDir || "(未指定)"}\n  修复：传 $CLAWGOD_DIR/bunfs 绝对路径。`);
}
const clawgodDir = path.dirname(bunfsDir);
const backupDir = path.join(clawgodDir, "bunfs.zh-cn-backup");
const markerFile = path.join(clawgodDir, ".zh-cn-patched");

// ---- 恢复模式 ----
if (restoreMode) {
  if (!fs.existsSync(backupDir)) {
    console.log("patch-bunfs: 无备份目录，无需恢复");
    process.exit(0);
  }
  let restored = 0;
  for (const name of fs.readdirSync(backupDir)) {
    const src = path.join(backupDir, name);
    const dst = path.join(bunfsDir, name);
    try {
      fs.copyFileSync(src, dst);
      restored++;
    } catch (e) {
      console.error(`patch-bunfs: 恢复失败 ${name}: ${e.message}`);
      process.exit(2);
    }
  }
  try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(markerFile); } catch {}
  console.log(`patch-bunfs: 已恢复 ${restored} 个 chunk，并移除备份与标记`);
  process.exit(0);
}

// ---- patch 模式 ----
const versionFile = path.join(clawgodDir, ".source-version");
const version = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, "utf8").trim() || "unknown"
  : "unknown";

// compute-patch-revision.sh 只定义函数、无独立入口：source 后调用（与 install.sh 一致）
const revR = spawnSync(
  "bash",
  ["-c", `source "${COMPUTE_REVISION}" && compute_patch_revision "${REPO_ROOT}"`],
  { encoding: "utf8" }
);
const revision = (revR.stdout || "").trim() || "unknown";

// 幂等：同版本同 revision 已 patch 过
if (!dryRun && fs.existsSync(markerFile)) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
    if (marker.version === version && marker.revision === revision) {
      console.log(`patch-bunfs: 已是最新（版本 ${version}，revision ${revision}），跳过`);
      console.log(`RESULT ${JSON.stringify({ status: "noop", patched: 0, failed: 0 })}`);
      process.exit(0);
    }
  } catch { /* 标记损坏则继续 patch */ }
}

const translations = JSON.parse(fs.readFileSync(TRANSLATIONS, "utf8"));
if (!Array.isArray(translations)) fail("cli-translations.json 不是数组");
const needles = translations.map((t) => (t && t.en) || "").filter(Boolean);

const chunks = fs.readdirSync(bunfsDir).filter((f) => /^chunk-.*\.js$/.test(f));
if (!chunks.length) fail(`bunfs 目录下无 chunk-*.js：${bunfsDir}`);

// 预筛：只处理含至少一个 needle 的 chunk
const candidates = [];
for (const name of chunks) {
  let text;
  try { text = fs.readFileSync(path.join(bunfsDir, name), "utf8"); } catch { continue; }
  if (needles.some((n) => text.includes(n))) candidates.push(name);
}

console.log(`patch-bunfs: 版本 ${version}，${chunks.length} 个 chunk，${candidates.length} 个含 UI 文案`);
if (!candidates.length) {
  console.log("RESULT " + JSON.stringify({ status: "noop", patched: 0, failed: 0 }));
  process.exit(0);
}

if (dryRun) {
  console.log("RESULT " + JSON.stringify({ status: "dry-run", patched: candidates.length, failed: 0 }));
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true });
const logFile = path.join(clawgodDir, "patch-bunfs.log");
const statusTmp = path.join(require("os").tmpdir(), `cczh-bunfs-status-${process.pid}`);

let patched = 0, failed = 0;
for (const name of candidates) {
  const chunk = path.join(bunfsDir, name);
  const backup = path.join(backupDir, name);
  const backupPreExisted = fs.existsSync(backup); // noop 清理备份时保护既有干净副本
  try { fs.unlinkSync(statusTmp); } catch {}
  const r = spawnSync(
    process.execPath,
    [PATCH_CLI, chunk, TRANSLATIONS, "--backup", backup, "--status", statusTmp, "--log", logFile],
    { encoding: "utf8" }
  );
  const status = fs.existsSync(statusTmp) ? fs.readFileSync(statusTmp, "utf8").trim() : "error";
  try { fs.unlinkSync(statusTmp); } catch {}
  const count = Number(String(r.stdout || "").trim()) || 0;

  if ((status === "ok" || status === "partial") && count > 0) {
    patched++;
  } else if (status === "partial" && count === 0) {
    // 已汉化的 chunk 重跑：规则匹配不到中文源，0 处替换——视为干净跳过，非失败
  } else if (status === "noop") {
    // 零改动（如仅命中恒等翻译）：删除本次误建的备份，避免全量 ~50MB 无效备份；
    // 既有备份（可能是唯一干净副本）绝不删除
    if (!backupPreExisted) {
      try { fs.unlinkSync(backup); } catch {}
    }
  } else {
    failed++;
    console.error(`patch-bunfs: ${name} patch 失败（status=${status}），已回滚该 chunk`);
    // patch-cli.js 语法校验失败时不落盘，chunk 仍是原样；若已落盘（异常路径），从备份恢复
    const syntax = spawnSync(process.execPath, ["--check", chunk], { encoding: "utf8" });
    if (syntax.status !== 0 && fs.existsSync(backup)) {
      try { fs.copyFileSync(backup, chunk); } catch {}
    }
  }
}

// 覆盖面以备份目录中的 chunk 数为准：幂等重跑后 patched 仍反映真实汉化规模
let localized = patched;
try {
  localized = fs.readdirSync(backupDir).length;
} catch {}

try {
  fs.writeFileSync(
    markerFile,
    JSON.stringify({ version, revision, patched: localized, failed, date: new Date().toISOString() }, null, 2) + "\n"
  );
} catch (e) {
  console.error(`patch-bunfs: 写入标记失败：${e.message}`);
}

console.log(`patch-bunfs: 完成，成功 ${patched} 个 chunk${failed ? `，失败 ${failed} 个（已回滚）` : ""}`);
console.log("RESULT " + JSON.stringify({ status: failed ? "partial" : "ok", patched, failed }));
process.exit(failed ? 2 : 0);
