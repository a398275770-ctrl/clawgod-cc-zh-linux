# CLAUDE.md

> 项目地图与硬性约束见 `AGENTS.md`。本文件只保留**维护操作细节**，不重复架构与规则。

## 数据流（翻译数据单一来源）

- `verbs/zh-CN.json` — 187 个 spinner 动词翻译（**唯一数据源**）
- `tips/zh-CN.json` — 41 条 spinner 提示翻译（**唯一数据源**）
- `cli-translations.json` — 2314 条 UI 翻译对照表（英文→中文），`patch-cli.sh` 从此文件读取
- `settings-overlay.json` 只含 language、spinnerTipsEnabled 等独有配置，**不含** verbs/tips 数据
- `install.sh` 安装时从上述两个 JSON 现场组装，合并到 `~/.claude/settings.json`
- 改翻译只改 `verbs/`、`tips/` 或 `cli-translations.json`，然后跑 `bash scripts/sync-payload.sh` 同步负载

## 技术要点（Patch 层）

- `patch-cli.sh` 用**内容匹配**（匹配英文原文），不依赖变量名，跨版本稳定
- 从 `cli-translations.json` 批量读取翻译，按字符串长度**降序**替换（长字符串优先，避免子串冲突）
- cli.js 里的 `…` 是真实 U+2026 字符，不是 `…` 转义序列
- node -e 在 bash 单引号里，用 Unicode 转义（`\uXXXX`）写中文，避免引号嵌套问题
- Hook 等技术术语保留英文（Hook 不是"钩子"，同 API、PR）
- Windows 兼容：NTFS 上 `fs.renameSync` 先 unlink 再 rename

## PR 收尾清理

PR 合并或关闭后：

1. `git fetch origin --prune`
2. 检查 `git worktree list`、`git branch -vv` 和 PR 状态
3. 确认无用且工作区干净的 worktree、本地分支、远端残留分支都清掉
4. squash merge 后不能只按 `git branch --merged` 判断是否可删；本地分支仍显示独立提交时，结合 GitHub PR 状态和 worktree 干净程度再决定

## 版本发布流程

1. **升版本号** — 改 `plugin/manifest.json` 的 `version`（语义化版本）
2. **更新 CHANGELOG** — 顶部新增版本段落，分"新增/改进/修复"
3. **提交** — message 带版本号
4. **打 tag** — `git tag vX.Y.Z`
5. **推送** — `git push origin main --tags`
6. **发 Release** — `gh release create vX.Y.Z --title "vX.Y.Z" --notes "变更摘要"`
7. **发布状态校验** — `bash scripts/preflight.sh --release-state`，确认 manifest / CHANGELOG / tag / GitHub Release 对齐
