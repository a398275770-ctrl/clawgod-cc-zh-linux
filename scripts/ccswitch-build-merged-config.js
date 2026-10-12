#!/usr/bin/env node
/**
 * ccswitch-build-merged-config.js — 深合并 CC Switch 通用配置与中文 overlay
 *
 * 从 install.sh 的 ccswitch_build_merged_config 内嵌 heredoc 逐字抽离（行为守恒，批次 3a）。
 * 输入（env）：ZH_CN_CCSWITCH_CURRENT_FILE / ZH_CN_CCSWITCH_OVERLAY_FILE / ZH_CN_CCSWITCH_OUTPUT_FILE
 * 行为：合并结果写入 OUTPUT_FILE；输入非法时 exit 2。
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

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(result[key]) && isPlainObject(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const current = readJson(process.env.ZH_CN_CCSWITCH_CURRENT_FILE, {});
const overlay = readJson(process.env.ZH_CN_CCSWITCH_OVERLAY_FILE, {});

if (!isPlainObject(current) || !isPlainObject(overlay)) {
  process.exit(2);
}

fs.writeFileSync(
  process.env.ZH_CN_CCSWITCH_OUTPUT_FILE,
  `${JSON.stringify(deepMerge(current, overlay), null, 2)}\n`
);
