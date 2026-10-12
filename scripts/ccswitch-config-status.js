#!/usr/bin/env node
/**
 * ccswitch-config-status.js — 判定 CC Switch 通用配置与中文 overlay 的同步状态
 *
 * 从 install.sh 的 sync_ccswitch_common_config 内嵌 heredoc 逐字抽离（行为守恒，批次 3a）。
 * 输入（env）：ZH_CN_CCSWITCH_CURRENT_FILE / ZH_CN_CCSWITCH_OVERLAY_FILE
 * 输出（stdout）：ok | needs-sync | invalid
 */

"use strict";

const fs = require("fs");

function readJson(file, fallback) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function spinnerVerbCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!isPlainObject(value)) return 0;
  if (Array.isArray(value.verbs)) return value.verbs.length;
  return Object.keys(value).length;
}

function spinnerTipCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!isPlainObject(value)) return 0;
  if (Array.isArray(value.tips)) return value.tips.length;
  return 0;
}

const current = readJson(process.env.ZH_CN_CCSWITCH_CURRENT_FILE, {});
readJson(process.env.ZH_CN_CCSWITCH_OVERLAY_FILE, {});

if (!isPlainObject(current)) {
  process.stdout.write("invalid");
  process.exit(0);
}

const complete =
  current.language === "Chinese" &&
  current.spinnerTipsEnabled === true &&
  spinnerVerbCount(current.spinnerVerbs) >= 100 &&
  spinnerTipCount(current.spinnerTipsOverride) >= 40;

process.stdout.write(complete ? "ok" : "needs-sync");
