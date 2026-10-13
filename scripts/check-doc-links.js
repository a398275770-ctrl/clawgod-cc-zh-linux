#!/usr/bin/env node
/**
 * check-doc-links.js — 文档死链与必填节校验（零依赖，D2 决策）
 *
 * 检查项：
 *   1. Markdown 相对链接（含 `code` 形式的路径引用）指向的文件必须存在；
 *   2. docs/index.md 中表格列出的每个 `path` 引用必须存在；
 *   3. 关键文档必须含必填节（见 REQUIRED_SECTIONS）。
 *
 * 用法：node scripts/check-doc-links.js [--dir <docs目录>] [--strict]
 * 退出码：0 通过；1 存在死链/缺节。
 *
 * 修复指引：报错信息会给出文件与链接，修正路径或在 docs/index.md 同步条目。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

// 关键文档的必填节（阶段 3 文档门禁会复用此表）
const REQUIRED_SECTIONS = {
  "AGENTS.md": ["## 这是什么项目", "## 常用命令", "## 硬性约束", "## 如何开始"],
  "ARCHITECTURE.md": ["## 领域划分", "## 依赖方向规则"],
  "docs/index.md": ["## 入口与规范", "## 执行计划与技术债"],
  "docs/CI.md": ["## 1. 框架判定", "## 2. 现有 CI 现状"],
  "docs/QUALITY_SCORE.md": ["## 评分口径", "## 评分依据"],
};

// 扫描这些文件的相对链接
const LINK_SOURCES = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CLAUDE.md",
  "docs/index.md",
  "docs/CI.md",
  "docs/QUALITY_SCORE.md",
  "docs/design-docs/core-beliefs.md",
  "docs/exec-plans/completed/clawgod-bunfs-adaptation-2026-10-12.md",
  "docs/exec-plans/completed/harness-2026-10-12.md",
  "docs/exec-plans/tech-debt-tracker.md",
];

// 匹配 markdown 链接 [x](path) 与反引号包裹的相对路径 `path`
const MD_LINK_RE = /\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
const CODE_PATH_RE = /`((?:\.\.\/|[a-zA-Z0-9_-]+\/|\.\/)?[a-zA-Z0-9_./-]+\.(?:md|json|sh|js|ps1|yml|yaml|txt))`/g;

const IGNORE_PREFIXES = ["http://", "https://", "mailto:"];

function checkFileLinks(file, strict) {
  const abs = path.join(REPO_ROOT, file);
  if (!fs.existsSync(abs)) {
    return [`MISSING SOURCE: ${file} 本身不存在（从 LINK_SOURCES 移除或创建该文件）`];
  }
  const content = fs.readFileSync(abs, "utf8");
  const errors = [];
  const seen = new Set();

  const candidates = [];
  let m;
  while ((m = MD_LINK_RE.exec(content))) candidates.push(m[1]);
  if (strict) while ((m = CODE_PATH_RE.exec(content))) candidates.push(m[1]);

  for (const raw of candidates) {
    if (IGNORE_PREFIXES.some((p) => raw.startsWith(p))) continue;
    if (raw.includes("${") || raw.includes("<")) continue; // 模板占位
    const target = path.resolve(path.dirname(abs), raw);
    const rel = path.relative(REPO_ROOT, target);
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!fs.existsSync(target)) {
      errors.push(`DEAD LINK: ${file} -> ${raw}\n  修复：确认目标是否移动/改名；若文档已归档，更新引用路径；若条目已不存在，从 ${file} 移除`);
    }
  }
  return errors;
}

function checkRequiredSections() {
  const errors = [];
  for (const [file, sections] of Object.entries(REQUIRED_SECTIONS)) {
    const abs = path.join(REPO_ROOT, file);
    if (!fs.existsSync(abs)) {
      errors.push(`MISSING: ${file}\n  修复：重建该文档（骨架见 docs/exec-plans/completed/harness-2026-10-12.md 附录引用）`);
      continue;
    }
    const content = fs.readFileSync(abs, "utf8");
    for (const sec of sections) {
      if (!content.includes(sec)) {
        errors.push(`MISSING SECTION: ${file} 缺少必填节 "${sec}"\n  修复：补上该节；若结构调整是有意的，同步修改 scripts/check-doc-links.js 的 REQUIRED_SECTIONS`);
      }
    }
  }
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");

  let errors = [];
  for (const f of LINK_SOURCES) errors = errors.concat(checkFileLinks(f, strict));
  errors = errors.concat(checkRequiredSections());

  if (errors.length) {
    console.error(`check-doc-links: ${errors.length} 个问题`);
    for (const e of errors) console.error("  " + e.split("\n").join("\n  "));
    process.exit(1);
  }
  console.log(`check-doc-links: OK（${LINK_SOURCES.length} 个来源文件，${Object.keys(REQUIRED_SECTIONS).length} 个必填节文档）`);
}

main();
