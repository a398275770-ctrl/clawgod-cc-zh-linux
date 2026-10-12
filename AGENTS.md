# AGENTS.md

> 本文件是**内容目录**，不是百科全书。需要细节时，按下方指引跳转。

## 这是什么项目

Claude Code CLI 中文本地化插件：通过 settings 注入、插件 hooks、CLI 硬编码文字安全 Patch 三层机制，把 Claude Code 界面汉化为简体中文；npm、官方 native binary、Windows bytecode 三种安装形态均支持，Patch 失败自动回滚英文保证 CLI 可用。

## 如何开始

- 架构总览：见 `ARCHITECTURE.md`
- 设计理念与操作原则：见 `docs/design-docs/core-beliefs.md`
- 当前执行计划：见 `docs/exec-plans/active/`
- 已知技术债：见 `docs/exec-plans/tech-debt-tracker.md`
- CI 与发布决策：见 `docs/CI.md`
- 文档总索引：见 `docs/index.md`
- 维护细节（数据流、发布步骤、PR 收尾）：见 `CLAUDE.md`

## 硬性约束（不可违反）

1. **翻译数据单一数据源**：`verbs/zh-CN.json`、`tips/zh-CN.json` 是唯一来源；**禁止**把动词/提示复制进 `settings-overlay.json` 或任何第二处。关键数据文件：
   - `cli-translations.json` — 2314 条 UI 翻译对照表（英文→中文），`patch-cli.sh` 从此读取
   - `verbs/zh-CN.json` — 187 个 spinner 动词翻译（**唯一数据源**）
   - `tips/zh-CN.json` — 41 条 spinner 提示翻译（**唯一数据源**）
2. **负载同步**：根目录 6 个文件（`patch-cli.{sh,js}`、`cli-translations.json`、`bun-binary-io.js`、`compute-patch-revision.sh`、`settings-overlay.json`）是源，`plugin/` 下是副本；改源后必须跑 `bash scripts/sync-payload.sh`，CI 会拦截不一致。
3. **零 npm 依赖**：不引入 `package.json`；lint/覆盖率/检查工具一律自研脚本放 `scripts/`（2026-10-12 决策 D2）。
4. **sh/ps1 成对变更**：`install.sh` 与 `install.ps1` 是同一逻辑的双端实现，改动必须成对（决策 D3）；`uninstall.*` 同理。
5. **Patch 安全红线**：只改显示文本，不动代码逻辑/注释/正则；Patch 结果必须通过 JS 语法校验才落盘，失败回滚英文。
6. **不直接 push main**：改动走分支 + PR（除非用户明确说直接推 main）；合并后按 `CLAUDE.md` 收尾清理分支与 worktree。

## 常用命令

- 测试（全量）：`node --test tests/`
- 测试（单文件）：`node --test tests/<name>.test.js`
- 本地门禁（一条命令）：`bash scripts/check-all.sh`（`--fast` 跳过测试；清单见 `docs/GATES.md`）
- 安装 pre-push 钩子：`bash scripts/install-git-hooks.sh`
- 既有 PR 门禁：`bash scripts/preflight.sh`（PR 分支上；加 `--release-state` 做发布收尾校验）
- 负载同步：`bash scripts/sync-payload.sh`
- 安装 / 卸载：`./install.sh` / `./uninstall.sh`（Windows 用 `install.ps1`）
- 诊断本机安装状态：`bash doctor.sh`

## 规范索引

- 设计原则：`docs/design-docs/core-beliefs.md`
- 支持版本矩阵：`docs/support-matrix.md`
- 离线安装：`docs/offline-install.md`
- 本地化审计与修复记录：`docs/localization-audit-2026-10-09.md`、`docs/localization-fix-2026-10-10.md`
- 经验教训：`docs/lessons.md`
- 质量评分：`docs/QUALITY_SCORE.md`

## 工作方式

- 变更前先读相关 `docs/`，变更后同步更新文档与 `docs/index.md`
- 提交粒度单一职责，Conventional Commits；会话最后一次提交须过本地门禁
- 版本发布按 `CLAUDE.md`「版本发布流程」执行，发布后跑 `bash scripts/preflight.sh --release-state`
- 计划写在 `docs/exec-plans/active/`，完成后移入 `completed/`
- 交互式决策确认后必须写入仓库文档（落盘才算数）
