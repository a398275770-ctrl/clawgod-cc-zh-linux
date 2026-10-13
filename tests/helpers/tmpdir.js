#!/usr/bin/env node
/**
 * tests/helpers/tmpdir.js — 测试临时目录的创建与自动清理（零依赖）
 *
 * 解决的问题（TD-QA-008，P1）：tests/ 下 43 个文件、约 150 处调用
 * `fs.mkdtempSync(path.join(os.tmpdir(), "<prefix>-"))` 创建 fixture 目录，跑完从不清理。
 * 每轮全量测试新增数千目录，长期累积把 /tmp（tmpfs）的 inode 配额占满——
 * 实测 10977 个目录 / 172594 个文件，260k 配额打满后任何需要创建文件的流程
 * 静默失败（lcov reporter 无输出、check-coverage 报「未解析到任何仓库内源码文件」）。
 *
 * 用法（与原有 mkdtempSync 写法等价，只多一个 prefix 语义）：
 *   const { mkTmpDir } = require("./helpers/tmpdir.js");
 *   const dir = mkTmpDir("cczh-doctor-");   // 返回路径；退出时自动删除
 *
 * 设计取舍：
 * - 用 process 退出钩子统一清理，而不是 t.after()：多数调用点在 test() 回调外的
 *   模块级 helper 函数里，拿不到 TestContext。改签名会波及 150 处调用点。
 * - 保留原 prefix 习惯，便于人工在 /tmp 下识别归属；CI 上失败时目录同样会被清理，
 *   需要现场取证可设 CCZH_KEEP_TMPDIRS=1 跳过清理。
 * - 清理失败（如权限问题）只警告不抛错：测试卫生问题不应把测试本身搞挂。
 */

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const created = [];
let hookInstalled = false;

function installExitHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  // exit 而非 beforeExit：beforeExit 在事件循环排空时触发，此时测试可能还在跑，
  // 提前删目录会让后续用例读到空 fixture。
  process.on("exit", cleanup);
}

function cleanup() {
  if (process.env.CCZH_KEEP_TMPDIRS === "1") return;
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // 卫生问题不升级为测试失败；但要让使用者看见
      process.stderr.write(`tmpdir: 清理失败 ${dir}: ${error.message}\n`);
    }
  }
  created.length = 0;
}

/**
 * 创建临时目录并在进程退出时自动删除。
 * @param {string} prefix 目录名前缀，建议沿用原有习惯（如 "cczh-doctor-"）
 * @returns {string} 目录绝对路径
 */
function mkTmpDir(prefix) {
  installExitHook();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

module.exports = { mkTmpDir, cleanup };
