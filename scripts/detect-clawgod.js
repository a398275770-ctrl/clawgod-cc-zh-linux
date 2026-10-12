#!/usr/bin/env node
/**
 * detect-clawgod.js — 检测 clawgod 封装的 bunfs 布局（决策 D6：clawgod 专属形态）
 *
 * clawgod 布局特征：$CLAWGOD_DIR/cli.cjs（bun 启动器）+ $CLAWGOD_DIR/bunfs/chunk-*.js
 * （真实 UI 代码散块；官方 detect 的 npm/native 路径均不命中此形态）。
 *
 * 输出（stdout）："clawgod-bunfs:<bunfs 绝对路径>"；未命中输出为空。
 * env：CLAWGOD_DIR（默认 ~/.clawgod）
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const clawgodDir = process.env.CLAWGOD_DIR || path.join(os.homedir(), ".clawgod");
const cliCjs = path.join(clawgodDir, "cli.cjs");
const bunfsDir = path.join(clawgodDir, "bunfs");

if (!fs.existsSync(cliCjs) || !fs.statSync(cliCjs).isFile()) process.exit(0);
if (!fs.existsSync(bunfsDir) || !fs.statSync(bunfsDir).isDirectory()) process.exit(0);

let hasChunk = false;
try {
  hasChunk = fs.readdirSync(bunfsDir).some((f) => /^chunk-.*\.js$/.test(f));
} catch {
  hasChunk = false;
}
if (!hasChunk) process.exit(0);

process.stdout.write("clawgod-bunfs:" + bunfsDir);
