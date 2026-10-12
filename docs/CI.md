# CI 配置决定

## 1. 框架判定
- 判定结果：**其他类型**（CLI 插件项目，非桌面应用）
- 判定证据（§3.2 机械判定，均未命中 Tauri）：
  - 不存在 `src-tauri/tauri.conf.json`
  - 不存在 `src-tauri/Cargo.toml`
  - 不存在根 `package.json`（更无 `@tauri-apps/cli` / `@tauri-apps/api` 依赖）
  - 项目形态：Bash/PowerShell 安装脚本 + Node.js 脚本 + Claude Code 插件目录（`plugin/`），通过 curl|bash、本地脚本或官方插件市场分发
- 判定日期：2026-10-12

## 2. 现有 CI 现状（存量项目必填）

| 文件 | 触发条件 | 覆盖平台 | 是否自动发布 | 备注 |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | push/PR → main，workflow_dispatch | ubuntu / windows / macOS（4 个 job：test、windows-install-smoke、linux-native-compat、windows-native-compat、macos-bytecode-compat） | 否 | 主验证流水线：preflight、payload 源守护、node --test、原生兼容验证（需 node-lief） |
| `.github/workflows/native-latest-candidate.yml` | push、workflow_dispatch（可指定 Claude Code 版本） | 多平台 | 否 | 跟踪上游最新版的原生兼容候选验证，含覆盖率状态记录（warning 级） |
| `.github/workflows/pages.yml` | push → main（仅 `site/**`） | ubuntu | 发布 GitHub Pages | 项目站点部署 |
| `.github/workflows/upload-remote-assets.yml` | release: published | ubuntu | 上传 Release 资产 | 远程安装脚本资产上传 |

**已有发布链路**：无 `package.json` scripts；发布流程为人工步骤（文档化在 `AGENTS.md`「版本发布流程」：改 `plugin/manifest.json` 版本 → CHANGELOG → commit → tag → push → `gh release create` → `scripts/preflight.sh --release-state` 校验）。Release 发布后由 `upload-remote-assets.yml` 接力。

**审计结论（阶段 1，仅审计不改动）**：4 个 workflow 与项目形态匹配，未发现明显腐烂；无多平台桌面打包需求，现有 matrix 是测试验证用途而非打包发布，合理。缺口在「无覆盖率门禁、无 lint/格式化门禁、无文档门禁」，已登记问题清单（TD-QA-001/002/003）。

## 3. 交互确认记录（仅 Tauri 填写）

不适用。§3.2 判定为「其他类型」，按 §3.4 跳过三问，不生成打包/Release 流水线。

## 4. 落地说明

- 框架判定 = 其他类型，多平台打包与 Release 流水线**不适用**（§3.4）。
- 基础门禁（lint / test / build 三件套 + 覆盖率 + 文档门禁）按 §5 阶段 3 落地，届时更新本节。
- 现有 4 个 workflow 保留不动；如需清理须单独征求同意。

## 5. 变更历史

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-12 | 建立本文档；框架判定为其他类型；审计现有 4 个 workflow | 阶段 1 全量扫描产出（§3.2 / §3.4） |
