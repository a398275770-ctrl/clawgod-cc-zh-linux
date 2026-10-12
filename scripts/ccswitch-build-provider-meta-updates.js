#!/usr/bin/env node
/**
 * ccswitch-build-provider-meta-updates.js — 生成 CC Switch providers 表的 meta 更新 SQL
 *
 * 从 install.sh 的 ccswitch_build_provider_meta_updates 内嵌 heredoc 逐字抽离（行为守恒，批次 3a）。
 * 输入（env）：ZH_CN_CCSWITCH_PROVIDERS_FILE（hex(id)\thex(meta) 行）/ ZH_CN_CCSWITCH_PROVIDER_SQL_FILE（输出）
 * 输出（stdout）："<changed> <total> <skipped>"
 */

"use strict";

const fs = require("fs");

function fromHex(hex) {
  return Buffer.from(hex || "", "hex").toString("utf8");
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const raw = fs.readFileSync(process.env.ZH_CN_CCSWITCH_PROVIDERS_FILE, "utf8").replace(/\r/g, "");
const lines = raw.split("\n").filter(Boolean);
const updates = [];
let changed = 0;
let skipped = 0;

for (const line of lines) {
  const tab = line.indexOf("\t");
  if (tab < 0) {
    skipped += 1;
    continue;
  }

  const id = fromHex(line.slice(0, tab));
  const metaText = fromHex(line.slice(tab + 1).trim());
  let meta;

  try {
    meta = metaText.trim() ? JSON.parse(metaText) : {};
  } catch (_) {
    skipped += 1;
    continue;
  }

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    skipped += 1;
    continue;
  }

  if (meta.commonConfigEnabled !== true) {
    changed += 1;
  }
  meta.commonConfigEnabled = true;

  updates.push(
    `update providers set meta=${sqlString(JSON.stringify(meta))} where id=${sqlString(id)} and app_type='claude';`
  );
}

fs.writeFileSync(process.env.ZH_CN_CCSWITCH_PROVIDER_SQL_FILE, updates.join("\n") + (updates.length ? "\n" : ""));
process.stdout.write(`${changed} ${lines.length} ${skipped}`);
