# docs 索引

> 全部文档的单一入口。新增/移动/删除文档时必须同步本文件；死链会被文档门禁拦截（阶段 3 落地）。

## 入口与规范

| 文档 | 说明 | 校验状态 |
|---|---|---|
| `../AGENTS.md` | 项目地图（目录，非百科） | 2026-10-12 重写 |
| `../ARCHITECTURE.md` | 领域划分 / 数据流 / 依赖方向规则 / 平台矩阵 | 2026-10-12 建立 |
| `../CLAUDE.md` | 维护操作手册（数据流细节、PR 收尾、发布流程） | 2026-10-12 收敛 |
| `design-docs/core-beliefs.md` | 第一性原则与争议裁决依据 | 2026-10-12 建立 |
| `QUALITY_SCORE.md` | 分领域质量评分与差距 | 2026-10-12 建立 |

## 执行计划与技术债

| 文档 | 说明 |
|---|---|
| `exec-plans/completed/harness-migration-2026-10-13.md` | 归档：Harness 改造复审计划（第二轮，已竣工） |
| `exec-plans/tech-debt-tracker.md` | 技术债台账 |
| `exec-plans/completed/2026-04-21-native-binary-latest-support-research-brief.md` | 归档：native latest 支持调研 |
| `exec-plans/completed/2026-04-30-macos-native-experimental-validation.md` | 归档：macOS native 实验验证 |
| `exec-plans/completed/2026-05-26-windows-native-support.md` | 归档：Windows native 支持计划 |
| `exec-plans/completed/harness-2026-10-12.md` | 归档：Harness 工程化改造 |
| `exec-plans/completed/clawgod-bunfs-adaptation-2026-10-12.md` | 归档：clawgod bunfs 安装形态适配 |

## CI 与发布

| 文档 | 说明 |
|---|---|
| `CI.md` | 框架判定（=其他类型）与现有 4 个 workflow 审计 |
| `GATES.md` | 门禁清单（检查名/触发/失败含义/修复指引/豁免机制） |
| `TESTING.md` | 测试策略：分层、跳过用例登记（D5）、覆盖率门禁（D4）、已知缺口 |

## 本地化参考

| 文档 | 说明 |
|---|---|
| `support-matrix.md` | 版本支持矩阵（**生成物，禁止手改**；由 `scripts/generate-support-matrix.js` 产出） |
| `offline-install.md` | 离线安装指南（node-lief 本地包等） |
| `lessons.md` | 经验教训（历史踩坑记录） |
| `windows-2.1.289-local-validation.md` | Windows 2.1.289 本机验证记录 |

## 审计与修复档案（时点报告，内容反映报告日期当时状态）

| 文档 | 日期 |
|---|---|
| `localization-audit-2026-10-09.md`（+ `localization-audit-2026-10-09/` 证据目录、`-boundaries.md`） | 2026-10-09 |
| `localization-fix-2026-10-10.md` | 2026-10-10 |

## 其他

| 位置 | 说明 |
|---|---|
| `assets/` | 演示 gif/mp4、社交预览图 |
| `../site/` | 项目站点（pages.yml 部署） |
| `../CHANGELOG.md` | 版本变更记录 |
| `../SPEC.md` / `../CONTRIBUTING.md` / `../LOCAL-DELIVERY.md` | 规范 / 贡献指南 / 本地交付说明 |

## 施工期规范（harness 改造期间常驻）

| 位置 | 说明 |
|---|---|
| `HARNESS-RULES.md` | **施工图副本**（本仓库改造入口规范，每次新会话先读；竣工后按 §14.3 归档） |
| `templates/HARNESS-RULES.md` | **母本**（服务未来所有项目的模板原件；每做完一个改造项目回流迭代一次，见 §14.5） |
