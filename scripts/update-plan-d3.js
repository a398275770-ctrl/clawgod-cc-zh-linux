#!/usr/bin/env node
/**
 * update-plan-d3.js — 把 D3 拆分实施记录写进 harness-migration.md（一次性脚本）
 */

"use strict";

const fs = require("node:fs");

const p = "docs/exec-plans/active/harness-migration.md";
let t = fs.readFileSync(p, "utf8");

const anchor = "#### 附：D3 专项评估——`patch-cli.js` 拆分（2026-10-13 重评）";
if (!t.includes(anchor)) {
  console.error("锚点未找到");
  process.exit(2);
}
if (t.includes("**实施记录（2026-10-13，用户已接受全局重 patch）**")) {
  console.log("实施记录已存在，跳过");
  process.exit(0);
}

t = t.replace(anchor, anchor + "\n\n> **状态：已实施（2026-10-13，用户 D3 决策「接受指纹变化触发一次重 patch」）。** 实施结果见本节末尾「实施记录」。");

const conclusion = "**我的结论与建议：本轮仍不拆，但把\"能否拆\"的前提问题留给你决定。**";
if (!t.includes(conclusion)) {
  console.error("结论段未找到");
  process.exit(3);
}

const record = [
  "",
  "**实施记录（2026-10-13，用户已接受全局重 patch）**",
  "",
  "用户明确接受「拆分导致已安装用户触发一次重 patch」后实施。安全措施：",
  "",
  "1. **动手前手动快照**（用户要求\"会覆盖就要备份\"）：",
  "   - `~/.claude/settings.json` → `~/.claude/settings.json.pre-harness-split.20261013-163348`",
  "   - `~/.cc-switch/cc-switch.db` → `~/.cc-switch/cc-switch.db.pre-harness-split.20261013-163348`",
  "   - 均校验字节一致 + settings.json JSON 合法性",
  "2. **核查结论**：拆分不触碰 settings.json 与 CC Switch（`patch-cli.js` 对 \"settings.json\" 的 2 次提及均为**被翻译的英文原文**，非代码操作；写操作仅 5 处且全部针对 cli.js 自身）。",
  "3. **重 patch 本身安全**：`session-start` 的降级链为 `ok/partial/validation-failed`，后者不写盘、CLI 保持原样可用。",
  "",
  "实施方式与踩过的坑：",
  "",
  "- **形态**：抽离 23 个 `install*` 函数到同目录 `patch-cli-localizations.js`（861 行），主文件 1955 → 1127 行。主文件保持\"带顶层执行的单入口脚本\"，三路 spawn 调用方式不变（`require` 相对脚本自身解析，与 CWD 无关——已实测 plugin/ 分发形态可独立运行）。",
  "- **坑 1（导致 2 个测试回归）**：手工 grep 函数调用形态做依赖分析，漏掉了补丁函数内**表达式中的裸 `s` 访问**（`signature.exec(s)`、`s.split(x).length`）。这两个补丁无法经由 `tryReplace`/`tryRegexReplace` 表达，需显式注入 `state: {get, set, bump}`。教训固化为 `scripts/scan-state-access.js`（静态扫描裸 s/count 访问）。",
  "- **坑 2**：`tests/plugin-payload.test.js` 的 `pairs` 与 `check-payload-sources.js` 的 `payloadPairs` 是**两份独立的守护清单**，新增负载文件需同时登记（本次漏了前者，测试立即报出）。",
  "",
  "协调点全部落地（10/10）：`patch-cli.sh` 无需改（入口仍是 patch-cli.js）、`native-repair.js` revisionFiles、`patch-bunfs.js` 无需改、`sync-payload.sh` FILES、`check-payload-sources.js` payloadPairs、`compute-patch-revision.sh` 指纹清单、`install-json-helper.js` PATCH_REVISION_FILES（权威源）、`tests/plugin-payload.test.js` pairs、`check-all.sh` 负载一致性清单、`check-file-size.js` 注释。",
  "",
  "**验收证据**：",
  "",
  "- 行为守恒对拍：真实匹配串语料下，拆分前/后 **28 次替换、输出逐字节一致、计数一致**（含 duration formatter 与 unknown-model warning 两个曾出问题的补丁）",
  "- `tests/patch-cli.test.js` 60/60（其中 286 处\"patch 后出现中文\"正向断言、41 处覆盖本次抽离的 23 个补丁）",
  "- 全量 `node --test tests/` 549 用例 / 542 通过 / 0 失败 / 7 跳过",
  "- `bash scripts/check-all.sh` 11 项全绿；覆盖率反升 85.08% → 85.54%",
  "- 三路调用方验证：`patch-cli.sh` 入口、`native-repair.js` 加载、`patch-bunfs.js` 路径、**plugin/ 分发形态独立运行**",
].join("\n");

t = t.replace(conclusion, conclusion + record);
fs.writeFileSync(p, t);
console.log("✓ 计划文档已追加实施记录");
