# 技术债台账（tech-debt-tracker）

> 阶段 1 全量扫描产出（2026-10-12，分支 harnessing）。
> 字段定义见《存量项目 Harness 工程化规则》附录 B。优先级：P0 阻塞/正确性安全；P1 显著抬升维护成本；P2 整洁度。
> 表头约定（常驻）：ID / 标题 / 位置 / 类别 / 严重度 / 证据 / 修复建议 / 业务行为影响 / 关联批次 / 验收方式 / 状态。

| ID | 标题 | 位置 | 类别 | 严重度 | 证据 | 修复建议 | 业务行为影响 | 关联批次 | 验收方式 | 状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| TD-QA-001 | 无测试覆盖率度量与门禁 | `tests/`（492 用例）、`.github/workflows/ci.yml` | 测试 | P1 | `node --test tests/` 全量跑通（485 过/7 跳过/0 失败，33.6s），但全仓无覆盖率工具配置，CI 无覆盖率步骤（grep 仅命中 native-latest-candidate.yml 里上游兼容的 coverage 状态字段，非代码覆盖率） | 已落地（D4=node 内置 lcov）：check-coverage.js + coverage-thresholds.json（整体 75/65/70 + 9 个关键模块），接入 CI 与 check-all | 无 | 批次 4 | 门禁可拦截故意缺陷（tests/coverage-gate.test.js 6 例：整体不足/关键模块不足/缺失/fixture 污染均拦截） | 已完成（2026-10-12） |
| TD-QA-002 | 无 lint / 格式化门禁 | 仓库根（无 package.json、无 eslint/prettier 配置） | 架构 | P1 | 根目录无 `package.json`、无 `.eslintrc*`、无 `.prettierrc*`；代码风格靠约定（CLAUDE.md 文字描述） | 阶段 3 引入零依赖 lint 方案（D2=自研脚本），错误信息含修复指令 | 无 | 批次 2 | 故意违规时 lint 失败（**已实测**：file-size/doc-links 负向注入均 exit 1） | 已完成（2026-10-12：check-file-size/check-doc-links/check-version-alignment + gate-exemptions 豁免机制） |
| TD-QA-003 | 无文档防腐机制（死链/必填节/新鲜度校验缺失） | `docs/`（61 个文件，无 index.md） | 文档 | P1 | `docs/` 下无 `index.md`；无文档 lint；`docs/plans/` 3 份 2026-04/05 旧计划游离于 exec-plans 体系外；`docs/localization-audit-2026-10-09*` 为时点报告无保鲜标注 | 阶段 2 建 `docs/index.md` + 文档 linter（链接解析、必填节）；旧计划归档或迁入 exec-plans | 无 | 批次 1（脚本）/ 批次 2（CI 接入） | 文档 lint 在死链/缺节时失败（**已实测**：`scripts/check-doc-links.js` 双向验证通过，tests/doc-links.test.js 3 例全过） | 已完成（2026-10-12：脚本 + tests/doc-links.test.js + ci.yml 步骤 + check-all.sh 接入） |
| TD-QA-004 | 无本地提交前门禁（pre-commit / pre-push） | `.git/hooks/`（仅 sample）、无 `.husky/` | 架构 | P1 | 无 pre-commit 配置；现有检查（preflight.sh 等）只能在 CI 跑，本地提交无任何拦截 | 阶段 3 提供本地一条命令复现门禁（零依赖实现） | 无 | 批次 2 | 本地注入违规时拦截（check-all.sh --fast 实测全项通过；各检查项负向用例见 tests/） | 已完成（2026-10-12：scripts/check-all.sh + install-git-hooks.sh pre-push 钩子） |
| TD-COMPLEX-001 | `install.sh` 超长且含 153 行巨函数 | `install.sh:1-1492`；`sync_ccswitch_common_config()` 约 857-1010 行 | 复杂度 | P1 | 文件 1492 行；最大函数 `sync_ccswitch_common_config` 153 行、`register_official_plugin` 104 行（awk 度量）；函数内嵌多段 node heredoc，bash/JS 混杂 | 阶段 4 抽离：heredoc 中的 node 脚本下沉为 `scripts/` 独立文件（可单测），bash 只保留编排 | 无（纯重构） | 批次 3 | 门禁绿 + 测试通过 + 函数行数下降（**已达成**：sync_ccswitch 153→30、register 104→47，install.sh 1492→1299 行；新增 ccswitch-scripts 7 例、reconcile 5 例、ccswitch-sync 集成 3 例） | 已完成（2026-10-12，948e954/28f24b0/3087a39 等） |
| TD-COMPLEX-002 | `install.ps1` 与 `install.sh` 双实现平行维护 | `install.ps1`（1326 行）↔ `install.sh`（1492 行） | 重复 | P1 | 同一安装逻辑（CC Switch 同步、插件注册回退、launcher 注入）两套语言各写一遍；历史变更需在 CHANGELOG 中成对出现，易漂移 | **D3 已决策（2026-10-12）：不收敛，保持双实现**；阶段 3 建立「改动必须成对」自动检查（如对比两端函数清单/关键段落指纹），漂移时门禁失败 | 无 | 批次 2 | 成对检查脚本存在；故意只改一端时门禁失败（实测） | 待处理 |
| TD-COMPLEX-003 | `patch-cli.js` 文件过大 | `patch-cli.js`（1938 行，63 个函数） | 复杂度 | P2 | 单文件 1938 行；翻译替换主逻辑与安全校验、备份回滚、特殊 patch 混在一处 | 阶段 4 按职责拆分（替换引擎 / 备份回滚 / 特殊 patch 注册表），注意它会被整体复制到 `plugin/`，拆分需同步 sync-payload 机制 | 无 | — | — | 已豁免（2026-10-12 用户决策：延期。理由：payload/发布链路协调点 6+ 处、单一职责内聚文件、1609 行测试保护，成本>收益；如需重启见批次 3 评估记录） |
| TD-COMPLEX-004 | 测试文件巨型化 | `tests/session-start-hook.test.js`（1825 行）、`tests/patch-cli.test.js`（1609 行）、`tests/upstream-compat.test.js`（1193 行） | 复杂度 | P2 | 3 个测试文件超 1000 行，单文件承载多主题用例 | 按主题拆分测试文件（node --test 支持目录批量执行，无额外成本） | 无 | — | — | 已豁免（2026-10-12 用户决策：延期。理由：纯指标改动，测试运行无实际问题） |
| TD-DOC-001 | 缺少 `ARCHITECTURE.md` / `QUALITY_SCORE.md` | 仓库根 | 文档 | P1 | §2.1 必需四件中缺 2 件；领域（安装器 / patch 引擎 / 插件 hook / 原生二进制 IO / skill-i18n）无顶层依赖图 | 阶段 2 建立两文件；架构图与 `plugin/manifest.json`、`sync-payload.sh` 实际数据流核对 | 无 | 批次 1 | §2.1 四件齐备；抽样 3 处依赖描述与代码一致（sync-payload 6 文件清单、patch-cli 多方调用、verbs/tips 现场组装，均核对一致） | 已完成（2026-10-12，4117c19/a1904b3/62dc633） |
| TD-DOC-002 | `AGENTS.md` 与 `CLAUDE.md` 内容大体重复 | `AGENTS.md`（53 行）、`CLAUDE.md`（47 行） | 重复 | P2 | 两文件「项目结构/数据流/技术要点/发布流程」段落近乎一致，双份维护；且均缺 §2.2 要求的「常用命令」节（测试/lint 命令未列出） | 阶段 2 按附录 E 重写 AGENTS.md 为地图形态；CLAUDE.md 收敛为维护手册 | 无 | 批次 1 | AGENTS.md 约 75 行含常用命令节；重复段落已消除 | 已完成（2026-10-12，4117c19） |
| TD-VER-001 | `marketplace.json` 缺 version 字段，版本声明点不全 | `.claude-plugin/marketplace.json` | 依赖 | P2 | `plugin/manifest.json`=2.23.0、`plugin/.claude-plugin/plugin.json`=2.23.0、CHANGELOG=2.23.0 一致；但 marketplace.json 无 version（读取为 None），发布流程文档（AGENTS.md）只要求改 manifest.json 一处 | 已确认：marketplace.json 按官方市场规范无 version 字段，非声明点；真实声明点 = manifest.json + plugin.json + CHANGELOG 顶部 | 无 | 批次 2 | check-version-alignment.js 机械校验 3 处一致（漂移/缺失均失败，已实测） | 已完成（2026-10-12） |
| TD-QA-005 | 7 个跳过测试无显式登记 | `node --test` 输出 skipped=7 | 测试 | P2 | 全量测试 492 中 7 skipped；未在仓库文档说明跳过原因与恢复条件 | 已登记进 docs/TESTING.md「跳过用例登记」 | 无 | 批次 4 | 7 个跳过全部带原因与恢复条件（均为 Windows 平台条件，由 Windows CI 覆盖） | 已完成（2026-10-12，决策 D5） |
| TD-SEC-001 | 安全扫描未发现硬编码凭证（登记为已审计项） | 全仓 `*.js/*.sh/*.json` | 安全 | P2 | `grep -iE "sk-ant-|api_key|secret|token|password"` 命中 10 文件，抽查均为环境变量名引用（ANTHROPIC_API_KEY）或翻译文案内容，非真实凭证 | 无需修复；阶段 3 可考虑把秘密扫描加入 preflight 防回归 | 无 | 批次 2 | preflight 含秘密扫描步骤（可选） | 待处理 |
| TD-REL-001 | 发布流程为人工 7 步，无机械防呆 | `AGENTS.md`「版本发布流程」 | 性能/可靠性 | P2 | 发布依赖人按序执行 7 步；顺序错（先 tag 后改 manifest）无本地拦截，只有事后 `preflight.sh --release-state` 校验 | 已落地 pre-push 版本对齐校验（check-all.sh 内含 check-version-alignment.js） | 无 | 批次 2 | 故意制造版本漂移时校验失败（tests/version-alignment.test.js 实测） | 已完成（2026-10-12） |

## 已审计确认无问题的项（防重复登记）

- **root ↔ `plugin/` 负载复制**：`patch-cli.js`、`bun-binary-io.js`、`cli-translations.json` 等双份存在且逐字节一致（diff 验证），属有意设计（插件分发负载），已有 `payload-source-guard.test.js` 与 `preflight.sh --payload-source` 机械守护。**不是债务。**
- **翻译数据单一数据源**：`verbs/zh-CN.json`（187）/`tips/zh-CN.json`（41）唯一来源，README/AGENTS 声称的 2314 条与 `cli-translations.json` 实际条目数一致（python json 计数）。**符合不变量。**
- **测试基线**：492 用例 485 通过 0 失败（2026-10-12 实测），测试密度高于一般存量项目。
- **CI 现状**：4 个 workflow 与项目形态匹配，未发现腐烂配置（详见 `docs/CI.md`）。
- **业务行为变更类问题**：本次扫描**未发现**需要改行为的 bug 类条目；全部为「无行为影响」的重构/护栏类。
