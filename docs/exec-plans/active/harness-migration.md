# Harness 工程化改造计划

## 0. 元信息
- 项目 / 仓库：`claude-code-zh-cn`（Claude Code CLI 中文本地化插件，独立维护 fork）
- 分支：**待用户决策**（现状：本机在 `main`，本地领先 `origin/main` 46 个提交未推送；上一轮改造用 `harnessing` 分支，已合并）。§7.1 要求「禁止直接在主干上改造」→ 本轮默认建议新建 `harnessing` 分支，见 D1
- 计划版本 / 日期：v2 / 2026-10-13
- 状态：**待确认**
- 与上一轮的关系：2026-10-12 已完成一轮完整五阶段改造（`docs/exec-plans/completed/harness-2026-10-12.md`，DoD 1-9 达成）。**本轮是复审 + 补漏，不重做已完成项。**

## 1. 项目概况

- **定位**：把 Claude Code CLI 界面本地化为简体中文的插件。三层机制：settings 注入（spinner 动词/提示/语言偏好）→ 插件 hooks → CLI 硬编码文字安全 Patch（npm cli.js / 官方 native binary / Windows bytecode / clawgod bunfs 四种形态）。
- **技术栈**：Bash（`install.sh`/`uninstall.sh`）+ PowerShell（`install.ps1` 等，Windows 平行实现）+ Node.js 脚本。**无 `package.json`、零 npm 依赖**（2026-10-12 决策 D2，`core-beliefs.md` #13）；native patch 需外部 `node-lief@1.3.2`。测试用 Node 内置 `node:test`。
- **构建/运行/分发**：无构建步骤。分发四通道：① `install-remote.sh`（curl|bash，挂 Release 资产）；② 本地 `install.sh` / `install.ps1` / `install-local.ps1`；③ 官方插件市场（`plugin/` + `.claude-plugin/marketplace.json`）；④ `site/`（GitHub Pages）。发布为人工 7 步流程（`CLAUDE.md`「版本发布流程」），推送目标 `fork`。
- **顶层模块与入口点**（详见 `ARCHITECTURE.md`）：
  - 安装/卸载：`install.sh`（1360 行）、`install.ps1`（1382 行）、`uninstall.*`、`install-remote.sh`
  - Patch 引擎：`patch-cli.js`（1955 行 / 63 函数）、`bun-binary-io.js`（957 行）、`scripts/patch-bytecode.js`（766 行）、`scripts/patch-bunfs.js`
  - 插件负载：`plugin/`（manifest、hooks、commands、output-styles、skills + 根文件副本）
  - 数据：`cli-translations.json`（2314 条）、`verbs/zh-CN.json`（187）、`tips/zh-CN.json`（41）
  - 守护脚本：`scripts/` 下 30 个 preflight/check/verify/generate 类脚本
  - 测试：`tests/` 56 个文件、545 用例
- **当前测试与 CI 现状（2026-10-13 实测）**：
  - `node --test tests/` → 545 用例 / 538 通过 / 0 失败 / 7 跳过 / 34.2s
  - `bash scripts/check-all.sh` → **全绿**（doc-links / file-size / version-alignment / 派生计数 / 结构 S1-S2 / 负载一致性 / 全量测试 / 覆盖率门禁）
  - 覆盖率：整体行 79.74% / 分支 68.68% / 函数 74.31%（49 个仓库内源文件；**该口径含 plugin 副本双计，真实值见 TD-QA-006**）
  - CI：4 个 workflow（`ci.yml` 5 job / `native-latest-candidate.yml` / `pages.yml` / `upload-remote-assets.yml`）

## 2. 框架判定与 CI 现状（见 §3.2）

- 判定结果：**其他类型**（CLI 插件项目，非桌面应用）
- 判定证据（§3.2 三条机械判定全部未命中，2026-10-13 复核）：
  - 不存在 `src-tauri/tauri.conf.json`
  - 不存在 `src-tauri/Cargo.toml`
  - 不存在根 `package.json`（无 `@tauri-apps/cli` / `@tauri-apps/api`）
  - 追加复核：`grep -rl "tauri" --include="*.json" --include="*.toml" --include="*.js"` 全仓**零命中**
- 结论已写入 `docs/CI.md`（含 2026-10-12 原判定 + 2026-10-13 复核记录）。
- **按 §3.4 明确跳过 §3.3 三问**：不问「是否生成 GitHub CI / 目标平台 / Release 发布方式」，不生成任何多平台打包与 Release 流水线。本项目发布链路是「人工 tag + `gh release create` + `upload-remote-assets.yml` 接力」，与桌面打包无关。
- 现有 `.github/workflows/` 清单与触发条件：见 `docs/CI.md` §2（本轮再审计结论：4 个 workflow 仍匹配项目形态，未腐烂）。
- **本轮 CI 相关新问题**：`verify-settings-sources.js` 孤儿未接线（TD-CI-001）、`check-doc-links.js --strict` 从未被使用（TD-CI-002）。

## 3. 现状诊断

### 3.1 架构现状（模块依赖）

与 2026-10-12 诊断相比，架构**未发生变化**，上一轮建立的依赖方向规则 6 条仍在生效（`ARCHITECTURE.md`）。本轮扫描未发现新的循环依赖或跨域直连。sh/ps1 双实现的存量对称性仍是已知盲区（TD-COMPLEX-002 待处理）——本轮实测 55 个 sh 函数 vs 53 个 ps1 函数，语义归一后仍无法自动判定「缺失」与「有意不对称」，这是盲区的根因，见 D2。

### 3.2 复杂度热点（2026-10-13 实测）

| 位置 | 度量 | 与上一轮对比 |
|---|---|---|
| `plugin/patch-cli.js` + `patch-cli.js` | 各 1955 行 / 63 函数（字节一致双份） | 1938→1955，仍在膨胀（+17） |
| `tests/session-start-hook.test.js` | 1825 行 | 不变 |
| `tests/patch-cli.test.js` | 1626 行 | 1938→1626（-312，已在降） |
| `install.ps1` | 1382 行 | 1326→1382（+56） |
| `install.sh` | 1360 行，最大函数 `ccswitch_sync_apply` 61 行 | 1492→1360（-132）✅ |
| `tests/upstream-compat.test.js` | 1193 行 | 不变 |
| `scripts/verify-upstream-compat.js` | 1137 行 | 不变 |
| `scripts/zh-cn-doctor.js` + 副本 | 各 1100 行 | 新增进入 TOP10 |

`check-file-size.js` 阈值 2000 行，上述全部合规；3 个超 1000 行测试文件已在 TD-COMPLEX-004 豁免。**本轮不新增复杂度重构项**（无门禁违度、无热点恶化到需要干预）。

### 3.3 覆盖率真相（本轮最重要的新发现）

`scripts/check-coverage.js` 的 `isRepoSourceFile()` 把 `plugin/` 负载副本与根文件当两份独立代码统计，导致整体数字失真：

| 口径 | 文件数 | 行覆盖 |
|---|---|---|
| 当前（含双计） | 49 | 79.74%（12996/16297） |
| 剔除 plugin 副本 | **34** | **85.19%**（9563/11225） |
| 仅 plugin 副本 | 15 | 67.69%（3433/5072） |

双计 3 对（`cmp` 验证字节一致）：`patch-cli.js`↔`plugin/patch-cli.js`、`bun-binary-io.js`↔`plugin/bun-binary-io.js`、`scripts/detect-clawgod.js`↔`plugin/scripts/detect-clawgod.js`。

即：**副本口径把整体拉低 5.45 个百分点，而副本本就是同一份代码测一次即够。** 真实覆盖率 85.19% 高于阈值 75%，说明项目测试实际比门禁显示的更健康——但数字不可信本身就是债务（TD-QA-006）。

同时门禁只查「阈值内文件」，低覆盖文件无人点名：`scripts/native-repair.js` **13.5%**（24/178）、`plugin/bun-binary-io.js` 20.2%（副本）、`plugin/skill-i18n/translate.js` 57.7%（TD-QA-007）。

### 3.4 文档缺口

- `docs/exec-plans/active/` 为空但被 `AGENTS.md:13` 指引为「当前执行计划」位置（TD-DOC-004，本轮自愈）。
- `docs/HARNESS-RULES.md` 与 `docs/turn-project-to-harness-rules.md` 逐字节重复 1101 行×2，均未 git 跟踪（TD-DOC-003，需用户决策）。
- 其余文档体系（`index.md` + doc-lint + 派生计数同步）本轮验证仍健康：`node scripts/check-doc-links.js` 通过。
- **文档门禁的实际覆盖盲区**：`--strict` 模式（反引号路径死链）从未接线，实测全仓 86 处反引号路径引用不受校验（TD-CI-002）。

### 3.5 测试缺口

- 7 个跳过用例已在 `docs/TESTING.md` 登记（D5），恢复条件明确（Windows 平台条件）。
- 覆盖率盲区见 3.3：`native-repair.js` 13.5% 是最大缺口（上一轮已登记为「已知缺口」但无门禁约束，形同虚设）。
- 安装脚本 bash 编排层仍主要靠 smoke 测试覆盖（`tests/install-smoke.test.js` 682 行），单元级覆盖集中在 `scripts/*.js`。

### 3.6 安全审计（2026-10-13 重扫）

`sk-ant-` / `AKIA` / `ghp_` / PEM 私钥模式：**零命中**。`password|secret|api_key|token` 硬编码（排除 `process.env` / `${}`）：**零命中**。无 `package.json` 故无 lockfile 可扫；唯一外部依赖 `node-lief@1.3.2` 固定版本。**未发现新安全问题，本轮不新增安全条目。**

### 3.7 性能与可靠性审计

工具型项目，无 N+1/无界循环类风险。发布流程人工 7 步的防呆已由 `check-version-alignment.js`（pre-push）覆盖（TD-REL-001 已完成）。本轮未发现新可靠性问题。

### 3.8 提交门禁现状审计

| 维度 | 现状 |
|---|---|
| CI | `ci.yml` 5 job：test（含 8 个检查步骤）+ windows-install-smoke + linux/windows/macos 原生兼容 |
| 本地 | `bash scripts/check-all.sh` 一条命令复现全量（约 40s）；`--fast` 约 2s |
| 本地钩子 | **本机未安装**（`scripts/install-git-hooks.sh` 提供一键安装，但当前 checkout 未执行）——TD-OPS-001 |
| 孤儿工具 | `verify-settings-sources.js` 写完未接线（TD-CI-001） |
| 未接线能力 | `check-doc-links.js --strict` 从未使用（TD-CI-002） |

## 4. 改造批次划分

本轮问题全部为 P1/P2，无 P0。**批次设计原则：每批可独立 revert，每批都有回滚方案（红线 R8）。**

| 批次 | 覆盖业务域 | 主要目标 | 依赖前置 | 回滚方案 |
|---|---|---|---|---|
| 批次 1 | 度量口径与门禁补漏（护栏域） | TD-QA-006 覆盖率口径修正、TD-QA-007 低覆盖下限、TD-CI-001/002 孤儿接线、TD-COMPLEX-005 hook 双端成对门禁、TD-OPS-001 装钩子、TD-DOC-003/004 文档修正 | 计划确认 | 全部为 `scripts/` 与文档改动：逐文件 `git revert`；CI/门禁步骤单独 revert；**不触碰任何安装器与 patch 引擎业务代码**。覆盖率口径变更会导致阈值重算——若误判可整批 revert 恢复旧口径 |
| 批次 2 | （本轮不设）复杂度重构 | 上一轮已豁免（TD-COMPLEX-003/004）；`patch-cli.js` 1955 行仍在缓涨，但无门禁违度、无故障关联。**不主动开批次**；若用户要求，见 D3 | 批次 1 | — |

**批次边界说明（红线 R4）**：本轮扫描新发现的问题只登记不顺手修。台账中标记「已完成」的上一轮条目本轮复核未退化，不动。

## 5. 五阶段任务拆解

### 阶段 1 · 全量扫描与问题清单（本阶段，进行中）

12 个子任务全部完成。逐项对照：

| # | 子任务 | 产出 / 结论 |
|---|---|---|
| 1 | 建立仓库地图 | 计划 §1；`ARCHITECTURE.md` 已验证仍准确 |
| 2 | 识别项目框架 | §2：其他类型，三证据 + grep 零命中；`docs/CI.md` 已落盘 |
| 3 | 识别架构现状 | §3.1：无新循环/越层；sh/ps1 存量对称盲区仍是根因未解（D2） |
| 4 | 度量复杂度 | §3.2 TOP10 表；无新增门禁违度 |
| 5 | 识别重复代码 | root↔plugin 为有意设计（已守护）；sh/ps1 为有意冗余（D3）；HARNESS-RULES 双份重复是新发现（TD-DOC-003） |
| 6 | 盘点文档缺口 | §3.4：active/ 空指针、规则文档双份、strict 未接线 |
| 7 | 盘点测试缺口 | §3.5：覆盖率口径失真（TD-QA-006）、低覆盖无告警（TD-QA-007） |
| 8 | 安全审计 | §3.6：零命中，无新条目 |
| 9 | 性能与可靠性审计 | §3.7：无新问题 |
| 10 | 提交门禁现状审计 | §3.8：孤儿工具、未装钩子、strict 未接线 |
| 11 | 风险分级与排序 | 全部 P1/P2；P0 无。排序见 §6 优先级表 |
| 12 | 制定分域改造批次 | §4：单批次（护栏域），不碰业务代码 |

**产出物**：本文档、`docs/exec-plans/tech-debt-tracker.md`（第二轮 8 条）、`docs/CI.md`（追加复核记录）。
**分析脚本**：本轮度量全部由一次性命令完成（awk/wc/grep/cmp + node 内联 lcov 解析），无新增脚本——避免为一次性扫描留下维护负担（B6）。
**验收自证**：
- [x] 五阶段全部拆解，每个子任务有产出物与可机械检查验收标准（见 §5 各节）
- [x] 框架判定完成，命中证据（文件路径 + grep 结果）已写入 `docs/CI.md`
- [x] 问题清单每条含 ID / 位置 / 类别 / 严重度 / 证据（度量数据）/ 修复建议 / 业务行为影响 / 关联批次 / 验收方式 / 状态
- [x] bug 修复与业务变更两类：本轮**零条目**（两轮扫描均未发现需改行为的 bug）；台账中 TD-PAIR-001~004 为上一轮已完成的 bug 修复记录，与纯重构严格分离
- [x] 每批改造有独立回滚方案（§4）
- [ ] 计划文档中不存在只有标题没有分析的条目 → 待用户评审确认
- [x] 未修改任何业务代码：`git diff --stat` 为空；`git status --short` 仅 2 个未跟踪的规则文档 + 本轮新增的 3 个文档类文件

### 阶段 2 · 文档对齐（前置：阶段 1 计划已确认）

上一轮已完成四件必需（`AGENTS.md` 58 行 / `ARCHITECTURE.md` 50 行 / `docs/exec-plans/` / `docs/QUALITY_SCORE.md`），且 `AGENTS.md` ≤200 行、`docs/index.md` 链接全部可解析（doc-lint 通过）。**本轮阶段 2 只做增量修正，不重写**：

1. 修正 `AGENTS.md:13` 的「当前执行计划」指引（说明 active/ 无计划时为空）——TD-DOC-004
2. 处理 `docs/HARNESS-RULES.md` 双份重复（保留一份，另一份按 D4 决策处置）——TD-DOC-003
3. `docs/GATES.md` 增补本轮新增门禁条目（覆盖率口径、低覆盖下限、hook 成对）
4. `docs/QUALITY_SCORE.md` 更新评分依据为真实口径覆盖率（85.19%）+ 本轮批次完成后重算
5. `docs/TESTING.md` 更新「已知缺口」节（native-repair.js 若本轮补测则更新）

**可机械检查验收**：`AGENTS.md` ≤200 行且必填节齐（doc-lint 校验）；`docs/index.md` 链接全解析；`QUALITY_SCORE.md` 每项分数有可复算依据（附度量命令）。

### 阶段 3 · 门禁审计与自动化质量校验（前置：阶段 2 通过）

**不执行 §3.3 三问**——§3.2 判定为其他类型，按 §3.4 跳过（记录见 `docs/CI.md` §3）。本轮阶段 3 全部是「补齐既有门禁盲区」，不生成任何 `.github/workflows/` 打包流水线：

1. 修 `check-coverage.js` 口径：排除与根字节一致的 `plugin/` 副本（TD-QA-006）；阈值重算并在 PR 说明
2. 加低覆盖下限：任一仓库内源文件行覆盖 < 阈值即失败，配 `floor.exempt` 白名单（TD-QA-007，最终定 50%，非原建议 30%）
3. 接线 `verify-settings-sources.js`（TD-CI-001；用户决策 D5=接线而非归档，删除未发生故无需 R5 同意记录）
4. 删除 `check-doc-links.js --strict` 死代码 + GATES.md 注明范围（TD-CI-002；用户决策 D6）
5. 扩展 `check-sh-ps1-pair.js` 的 `PAIRS`：加 `plugin/hooks/session-start`↔`.ps1`、`notification`↔`.ps1`（TD-COMPLEX-005）
6. 安装本机 pre-push 钩子（TD-OPS-001）
7. 根治测试临时目录泄漏 + 接入门禁（TD-QA-008，**本轮落地时新发现的 P1**）
8. 更新 `docs/GATES.md`：每个新门禁写清检查名/触发时机/失败含义/修复指引/豁免方式
9. 本地一条命令复现验证：`bash scripts/check-all.sh` 仍全绿

**落地状态（2026-10-13，commit 33263c9 / 68c1285 / 7b93a93）**：

| # | 事项 | 状态 |
|---|---|---|
| 1 | 覆盖率口径修正 | ✅ 完成，49→46 文件，79.74%→85.08% |
| 2 | 低覆盖下限 floor.minLineRate=50 | ✅ 完成，2 项 exempt（带 reason+expires 2027-01-13） |
| 3 | verify-settings-sources 接线 | ✅ 完成（D5） |
| 4 | 删除 --strict 死代码 | ✅ 完成（D6） |
| 5 | hook 双端加入 PAIRS | ✅ 完成，负向实测 exit 1 |
| 6 | pre-push 钩子 | ✅ 已安装 |
| 7 | TD-QA-008 临时目录泄漏 | ✅ 已根治，162 处调用迁移，实测零新增残留 |
| 8 | GATES.md | ✅ 已更新（含口径说明与不在校验范围两节） |
| 9 | check-all.sh 一条命令复现 | ✅ 10 项全绿 |

**可机械检查验收（每项须负向实测，禁止只看配置）**：
- [x] 故意把某源文件覆盖率压到低覆盖下限以下 → `check-coverage` 失败（实测 exit 1，点名文件）
- [x] 故意只改 `session-start.ps1` 不改 `session-start` → `check-sh-ps1-pair` 失败（实测 exit 1）
- [x] 覆盖率口径修正后：双计对消失、`--report` 输出可验证（实测 46 文件，双计对不再出现）
- [x] `floor.exempt` 到期自动失效（实测改 2020-01-01 → 报「豁免已过期」exit 1）
- [x] 每个门禁失败信息含可执行修复指引（沿用现有约定，新门禁均带修复行）
- [x] 门禁本地一条命令复现：`bash scripts/check-all.sh`（10 项）
- [x] 反触号路径死链一项：按 D6 决策改为「删除死代码 + 注明不在校验范围」，故不适用负向实测


### 阶段 4 · 问题修复与重构落地（前置：阶段 3 通过）

本轮**不设业务代码重构批次**。上一轮重构成果（`install.sh` 1492→1360 行、最大函数 153→61 行）本轮复核保持。若用户在 D3 要求处理 `patch-cli.js` 1955 行，则单开批次，前置是先评估 payload/发布链路协调点（上一轮评估为 6+ 处，成本>收益，曾决策延期）。

**验收**：本轮零重构提交 → 行为守恒天然成立（无改动即无行为变更）；复杂度指标与阶段 1 基线对比不变或更优。

#### 附：D3 专项评估——`patch-cli.js` 拆分（2026-10-13 重评）

> **状态：已实施（2026-10-13，用户 D3 决策「接受指纹变化触发一次重 patch」）。** 实施结果见本节末尾「实施记录」。

**结构实测**：1955 行 / 50 函数。最大函数 `scanStringLiterals` 350 行、`installCli233ResidualUILocalization` 204 行、`installStatusbarToolActivityLocalization` 186 行。22 个 `install*Localization` 系列函数集中在 807–1409 行，彼此**无耦合**，只共用一个工具函数 `tryRegexReplace`（101 次调用）。

**技术可行性：高**。依赖干净，可低风险抽离成 `patch-cli-localizations.js` 一类模块，主文件可降到约 1200 行。

**但有一个硬约束，且它不可绕过**：

`patch-cli.js` 是**带顶层执行的脚本，不是模块**（零本地 require、无 `module.exports`）。它被 3 个独立调用方以 `node patch-cli.js <参数>` 方式 spawn：

| 调用方 | 位置 |
|---|---|
| `patch-cli.sh`（安装器与 session-start hook 的入口） | `patch-cli.sh:21` |
| `scripts/native-repair.js`（native binary 修复） | `scripts/native-repair.js:119` |
| `scripts/patch-bunfs.js`（clawgod bunfs 逐 chunk 复用引擎） | `scripts/patch-bunfs.js:32` |

且它被 `sync-payload.sh` **整文件复制**到 `plugin/`，靠 `check-payload-sources.js` 守护字节一致。

**这意味着拆分不是"改一个文件"，而是改变一份被三路 spawn、整份复制分发、靠字节比对守护的核心负载的物理形态。** 清点出的协调点共 10 处：

1. `patch-cli.sh:21` — `node $SCRIPT_DIR/patch-cli.js` 指向新入口
2. `scripts/native-repair.js:119` — spawn 参数
3. `scripts/patch-bunfs.js:32` — `PATCH_CLI` 路径
4. `scripts/sync-payload.sh` FILES — 新增副本文件（**复制的是文件集合，不再是单文件**）
5. `scripts/check-payload-sources.js` payloadPairs — 新增守护对
6. `scripts/compute-patch-revision.sh:14` — 指纹文件清单
7. `install.sh:1219` — 调用参数
8. `tests/patch-cli.test.js`（1626 行）— 加载路径
9. `scripts/coverage-thresholds.json` keyFiles — `patch-cli.js` 条目含义变化
10. `scripts/check-file-size.js` — 阈值口径变化（当前 2000 行上限就是按它设的）

**关键风险**：`plugin/` 是**整目录交付**（`plugin/manifest.json` 无 files 白名单，已验证），所以分发本身无障碍。真正的风险在于 `compute-patch-revision.sh` 的**指纹机制**——它按文件集合算指纹，session-start hook 靠指纹判断"是否需要重 patch"。文件集合一变，所有已安装用户的指纹都会改变，触发一次**全局重 patch**。这是行为变更，不是纯重构。

**我的结论与建议：本轮仍不拆，但把"能否拆"的前提问题留给你决定。**
**实施记录（2026-10-13，用户已接受全局重 patch）**

用户明确接受「拆分导致已安装用户触发一次重 patch」后实施。安全措施：

1. **动手前手动快照**（用户要求"会覆盖就要备份"）：
   - `~/.claude/settings.json` → `~/.claude/settings.json.pre-harness-split.20261013-163348`
   - `~/.cc-switch/cc-switch.db` → `~/.cc-switch/cc-switch.db.pre-harness-split.20261013-163348`
   - 均校验字节一致 + settings.json JSON 合法性
2. **核查结论**：拆分不触碰 settings.json 与 CC Switch（`patch-cli.js` 对 "settings.json" 的 2 次提及均为**被翻译的英文原文**，非代码操作；写操作仅 5 处且全部针对 cli.js 自身）。
3. **重 patch 本身安全**：`session-start` 的降级链为 `ok/partial/validation-failed`，后者不写盘、CLI 保持原样可用。

实施方式与踩过的坑：

- **形态**：抽离 23 个 `install*` 函数到同目录 `patch-cli-localizations.js`（861 行），主文件 1955 → 1127 行。主文件保持"带顶层执行的单入口脚本"，三路 spawn 调用方式不变（`require` 相对脚本自身解析，与 CWD 无关——已实测 plugin/ 分发形态可独立运行）。
- **坑 1（导致 2 个测试回归）**：手工 grep 函数调用形态做依赖分析，漏掉了补丁函数内**表达式中的裸 `s` 访问**（`signature.exec(s)`、`s.split(x).length`）。这两个补丁无法经由 `tryReplace`/`tryRegexReplace` 表达，需显式注入 `state: {get, set, bump}`。教训固化为 `scripts/scan-state-access.js`（静态扫描裸 s/count 访问）。
- **坑 2**：`tests/plugin-payload.test.js` 的 `pairs` 与 `check-payload-sources.js` 的 `payloadPairs` 是**两份独立的守护清单**，新增负载文件需同时登记（本次漏了前者，测试立即报出）。

协调点全部落地（10/10）：`patch-cli.sh` 无需改（入口仍是 patch-cli.js）、`native-repair.js` revisionFiles、`patch-bunfs.js` 无需改、`sync-payload.sh` FILES、`check-payload-sources.js` payloadPairs、`compute-patch-revision.sh` 指纹清单、`install-json-helper.js` PATCH_REVISION_FILES（权威源）、`tests/plugin-payload.test.js` pairs、`check-all.sh` 负载一致性清单、`check-file-size.js` 注释。

**验收证据**：

- 行为守恒对拍：真实匹配串语料下，拆分前/后 **28 次替换、输出逐字节一致、计数一致**（含 duration formatter 与 unknown-model warning 两个曾出问题的补丁）
- `tests/patch-cli.test.js` 60/60（其中 286 处"patch 后出现中文"正向断言、41 处覆盖本次抽离的 23 个补丁）
- 全量 `node --test tests/` 549 用例 / 542 通过 / 0 失败 / 7 跳过
- `bash scripts/check-all.sh` 11 项全绿；覆盖率反升 85.08% → 85.54%
- 三路调用方验证：`patch-cli.sh` 入口、`native-repair.js` 加载、`patch-bunfs.js` 路径、**plugin/ 分发形态独立运行**

理由：
- 收益：单文件 1955→约 1200 行，可读性提升；`check-file-size` 阈值可下调
- 成本：10 处协调点 + 一次全局重 patch + `patch-cli.test.js` 1626 行测试的加载路径改造
- 而它**当前没有任何门禁违度**（1955 < 2000 阈值），无故障关联，功能持续正常交付

**若你仍要拆，必须先回答一个我无法推断的问题**：是否接受"拆分导致所有已安装用户触发一次全局重 patch"？若接受，我按 10 处协调点逐项提交（每项独立 revert）；若不接受，则拆分需设计成"文件集合不变、只在单文件内部重组"——而那对行数的改善有限，不值得做。

### 阶段 5 · 测试补全与门禁接入（前置：阶段 4 通过）

1. 补 `scripts/native-repair.js` 测试（当前 13.5%，24/178 行）——本轮最大覆盖缺口；若不可行（需真实 native binary fixture）则在 `docs/TESTING.md` 明确登记为已豁免缺口并说明理由（沿用 D5 精神：显式登记，不静默）
2. 评估 `plugin/skill-i18n/translate.js`（57.7%）与 `scripts/generate-upstream-text-diff.js`（69.7%）
3. 覆盖率口径修正后重设整体 + 关键模块阈值（真实口径 85.19% 留余量）
4. 负向实测：故意破坏实现 → 对应测试失败（抽样 ≥3）

**验收**：覆盖率报告（真实口径）；关键模块单独达标；P0 清零（本轮无 P0）；P1 全部关闭或有明确排期。

## 6. 优先级排序与待人工决策清单

### 6.1 问题排序（影响面 × 修复成本 × 改动风险）

| 序 | ID | 严重度 | 一句话 | 修复成本 | 改动风险 |
|---|---|---|---|---|---|
| 1 | TD-QA-006 | P1 | 覆盖率口径双计，整体数字失真 5.45pp | 低（改一个函数 + 重算阈值） | 低（只影响度量，不影响代码） |
| 2 | TD-COMPLEX-005 | P1 | hook 双端 1216 行不受成对门禁保护 | 低（PAIRS 加 2 项） | 低（纯门禁扩展） |
| 3 | TD-QA-007 | P1 | 低覆盖文件无告警（native-repair 13.5%） | 中（补测试） | 低 |
| 4 | TD-CI-002 | P2 | `--strict` 从未接线，反触号死链不校验 | 中（修正则，86 处需验证） | 中（误判风险，见下） |
| 5 | TD-CI-001 | P2 | `verify-settings-sources.js` 孤儿 | 低（接线或归档） | 低 |
| 6 | TD-DOC-004 | P2 | `active/` 空目录被指引为计划位置 | 极低 | 极低 |
| 7 | TD-OPS-001 | P2 | 本机未装 pre-push 钩子 | 极低 | 极低 |
| 8 | TD-DOC-003 | P2 | HARNESS-RULES 双份重复且未跟踪 | 低 | 低（但涉范围决策，见 D4） |

> TD-CI-002 风险说明：本轮实测 `--strict` 有 86 处命中，**其中多数是合法路径被 `CODE_PATH_RE` 误判**（该正则把反触号路径当相对文档目录解析，而文档写的是相对仓库根）。所以「修好再接入」需要先区分真死链与误判，工作量比表面大。若判断收益不足，选择「删除死代码 + GATES.md 注明范围」也是合规解。

### 6.2 待人工决策清单

| 编号 | 问题 | 为什么需要人判断 | 影响范围 |
|---|---|---|---|
| D1 | 本轮在哪个分支实施？ | §7.1 要求「禁止直接在主干上改造」；但本机 `main` 已领先 `origin/main` 46 个提交未推送，且这些提交本身就是功能/文档混合的历史。选项：①新建 `harnessing` 分支（合规，但要把 46 个未推送提交一并带过去或先推送）；②先在 main 上推送存量再开分支；③用户明确授权直接在 main 上改（本项目历史上 main 就是主战场，用户 CLAUDE.md 写「不直接 push main，除非用户明确说」） | 全部批次 |
| D2 | sh/ps1 存量对称性盲区是否要主动消除？ | TD-COMPLEX-002 的根因是「语义归一后仍无法自动判定缺失 vs 有意不对称」（本轮实测 55 vs 53 函数）。门禁只能拦增量漂移，拦不住存量缺失。彻底消除需要人工逐函数核对（上一轮靠 4 次 bug 修复即兴发现）。选项：①只扩展 PAIRS 拦增量（批次 1 方案，低成本）；②另开专项逐函数核对存量 | 阶段 3/4 |
| D3 | 是否处理 `patch-cli.js` 1955 行（+17 于上轮）？ | 上一轮已决策延期并豁免（TD-COMPLEX-003），理由是 payload/发布链路协调点 6+ 处、1609 行测试保护、成本>收益。本轮它仍在缓涨，但无门禁违度、无故障关联。是否重新评估由你定 | 阶段 4 |
| D4 | `docs/HARNESS-RULES.md` + `docs/turn-project-to-harness-rules.md` 双份重复如何处置？ | §14.5 说母本应在 `docs/templates/` 或独立模板仓库。两份当前**都未 git 跟踪**。选项：①两份都入库（保留双份，接受重复维护成本）；②只入一份 `docs/HARNESS-RULES.md`，另一份删除；③一份入库为施工图 + 一份移入 `docs/templates/` 作母本（符合 §14.5） | 阶段 2 |
| D5 | TD-CI-001（`verify-settings-sources.js` 孤儿）选择接线还是归档？ | 需先确认它的职责是否已被 `check-payload-sources.js` 覆盖——若重复则应归档，但**删除须单独征求同意**（R5）。我不自行判断删除 | 阶段 3 |
| D6 | TD-CI-002 选择「修好接入 strict」还是「删除死代码」？ | 涉及 86 处引用的人工甄别成本 vs 反触号死链的校验价值。你更看重哪个 | 阶段 3 |

## 7. 进度与决策日志

| 日期 | 阶段 | 动作 | 关联 commit | 决策与理由 |
|---|---|---|---|---|
| 2026-10-13 | 1 | 全量重扫（框架复核 / 覆盖率口径 / 门禁接线 / 安全 / 复杂度 / 文档）；产出计划 v2 + 台账第二轮 8 条 + CI.md 复核记录 | （待提交） | 定位为「复审+补漏」不重做；框架判定维持其他类型；未改任何业务代码（`git diff --stat` 为空自证） |
| 2026-10-13 | 1 | 待用户确认计划与 D1-D6 决策 | — | — |

---

> 本计划的「第二阶段及以后」内容在用户确认前**不得执行**（契约 C1/C2）。阶段 1 产出物仅限文档类文件新增与 `docs/CI.md` 追加记录，未触碰任何业务代码。
