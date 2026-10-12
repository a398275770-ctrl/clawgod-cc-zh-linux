#!/usr/bin/env node
/**
 * update-profile-injection.js — 向 shell profile 安装/移除 launcher source 行
 *
 * 从 install.sh 的 update_profile_injection 内嵌 heredoc 逐字抽离（行为守恒，批次 3a 补漏）。
 * 输入（env）：PROFILE_TARGET / PROFILE_MODE(install|remove) / PROFILE_MARKER_START / PROFILE_MARKER_END / PROFILE_SOURCE_LINE
 */

"use strict";

const fs = require("fs");
const path = process.env.PROFILE_TARGET;
const mode = process.env.PROFILE_MODE;
const start = process.env.PROFILE_MARKER_START;
const end = process.env.PROFILE_MARKER_END;
const sourceLine = process.env.PROFILE_SOURCE_LINE;
const block = `${start}\n${sourceLine}\n${end}`;

let content = "";
if (fs.existsSync(path)) {
  content = fs.readFileSync(path, "utf8");
}

const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockPattern = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, "g");
content = content.replace(blockPattern, "");

if (mode === "install") {
  const trimmed = content.replace(/\s+$/, "");
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  content = `${prefix}${block}\n`;
} else {
  content = content.replace(/\s+$/, "");
  if (content.length > 0) {
    content += "\n";
  }
}

fs.mkdirSync(require("path").dirname(path), { recursive: true });
fs.writeFileSync(path, content);
