# Harness 工程化改造计划

## 0. 元信息
- 项目 / 仓库：claude-code-zh-cn（Claude Code CLI 中文本地化插件）
- 分支：harnessing
- 计划版本 / 日期：v1 / 2026-10-12
- 状态：待确认

## 1. 项目概况
- **定位**：把 Claude Code CLI 界面本地化为简体中文的插件项目。四层实现：settings.json 注入（spinner 动词/提示/语言偏好）→ 插件 hooks → 官方插件体系 → CLI 硬编码文字安全 Patch（npm cli.js / 官方 native binary / Windows bytecode 三种形态）。
- **技术栈**：Bash（install.sh/uninstall.sh）+ PowerShell（install.ps1 等，Windows 平行实现）+ Node.js 脚本（无 package.json、零 npm 依赖；native patch 需外部 `node-lief@1.3.2`）。测试用 Node 内置 `node:test`。
- **构建/运行/分发**：无构建步骤。分发三通道：① `install-remote.sh`（curl|bash）；② 本地 `install.sh` / `install.ps1`；③ 官方插件市场（`plugin/` + `.claude-plugin/marketplace.json`）。发布为人工 7 步流程（AGENTS.md），Release 发布后 `upload-remote-assets.yml` 自动上传资产。
- **顶层模块与入口点**：
  - 安装/卸载：`install.sh`、`install.ps1`、`uninstall.*`、`install-remote.sh`
  - Patch 引擎：`patch-cli.js`（字符串字面量替换，1938 行）、`bun-binary-io.js`（bun 二进制提取/写回，957 行）、`scripts/patch-bytecode.js`（Windows bytecode 常量池）
  - 插件负载：`plugin/`（manifest、hooks、commands、output-styles、skills、payload 副本）
  - 数据：`cli-translations.json`（2314 条）、`verbs/zh-CN.json`（187）、`tips/zh-CN.json`（41）
  - 守护脚本：`scripts/preflight.sh` + 20 个 check/verify 类脚本
- **测试与 CI 现状**：48 个测试文件、492 用例（485 过 / 7 跳过 / 0 失败，实测 33.6s）；CI 4 个 workflow（详见 `docs/CI.md`）；无覆盖率工具、无 lint 配置、无本地 git hooks。

## 2. 框架判定与 CI 现状（见 §3.2）
- 判定结果：**其他类型**（CLI 插件，非 Tauri）
- 判定证据：无 `src-tauri/`、无 `package.json`；命中 0 条 Tauri 证据
- 现有 `.github/workflows/`：ci.yml / native-latest-candidate.yml / pages.yml / upload-remote-assets.yml（触发条件与审计结论见 `docs/CI.md`）
- 已有发布链路：人工 tag + `gh release create` + upload-remote-assets.yml 接力
- **按 §3.4 跳过 §3.3 三问**；现有 CI 仅审计不改动。

## 3. 现状诊断

### 架构现状（模块依赖）
```text
install.sh / install.ps1 ──调用──> patch-cli.sh → patch-cli.js ──读──> cli-translations.json
        │                                │
        ├─同步──> settings.json（verbs/tips 现场组装）│
        ├─同步──> plugin/ 负载（sync-payload.sh 从根复制）
        └─注册──> 官方插件市场 / 独立 hooks 回退
session-start hook ──检测上游更新──> 重跑 patch（指纹 = compute-patch-revision.sh）
native 形态：bun-binary-io.js（提取→patch-cli.js→写回）；bytecode 形态：patch-bytecode.js
```
- **优点**：翻译数据单一数据源（verbs/tips 唯一来源）已有文字级不变量；root→plugin 负载复制有机械守护（payload-source-guard）。
- **问题**：安装逻辑 sh/ps1 双实现（TD-COMPLEX-002）；bash 编排层内嵌大量 node heredoc，逻辑不可单测（TD-COMPLEX-001）；无显式分层/依赖方向约束（本项目体量下不强行套 §4.1 六层，先落地「脚本编排层不内嵌业务逻辑」一条，见批次 2/3）。
- 未发现循环依赖；跨域直连主要体现为 install.sh 直接操作 CC Switch SQLite 库（857-1010 行），属功能耦合而非架构违规，随 TD-COMPLEX-001 处理。

### 复杂度热点（度量）
| 位置 | 度量 |
|---|---|
| `install.sh` | 1492 行；最大函数 153 行（`sync_ccswitch_common_config`）、104 行（`register_official_plugin`） |
| `install.ps1` | 1326 行，与 install.sh 平行实现 |
| `patch-cli.js` | 1938 行 / 63 函数 |
| `tests/session-start-hook.test.js` | 1825 行 |
| `tests/patch-cli.test.js` | 1609 行 |
| `scripts/verify-upstream-compat.js` | 1137 行 |

### 重复代码
- root ↔ `plugin/`：有意负载复制（已守护，**非债务**）。
- `install.sh` ↔ `install.ps1`：真重复（TD-COMPLEX-002）。
- `AGENTS.md` ↔ `CLAUDE.md`：文档级重复（TD-DOC-002）。
- `scripts/*.js` ↔ `plugin/scripts/*.js`：负载复制（同第一类，已守护）。

### 文档缺口
- 缺 `ARCHITECTURE.md`、`QUALITY_SCORE.md`、`docs/index.md`、`docs/exec-plans/`（本次建立）。
- `docs/plans/` 3 份 2026-04/05 旧计划游离体系外；`docs/localization-audit-2026-10-09*` 时点报告无保鲜标注。
- AGENTS.md 缺「常用命令」节（如何跑测试/lint 未写）。

### 测试缺口
- 无覆盖率度量（无法量化缺口分布）→ 批次 4 先建度量再补缺口。
- 7 个跳过用例无登记（TD-QA-005）。
- 安装脚本的 bash 编排层逻辑主要靠 smoke 测试覆盖，单元级覆盖集中在 scripts/*.js。

### 安全与性能风险
- 硬编码凭证扫描：未发现（TD-SEC-001 登记为已审计）。`install-remote.sh` 的 curl|bash 模式为分发设计，非漏洞。
- 性能/可靠性：无明显 N+1/无界循环类风险（工具型项目）；发布流程人工 7 步无防呆（TD-REL-001）。
- 依赖：零 npm 依赖是显式特性；唯一外部依赖 node-lief 有 check-deps + 优雅降级。无 lockfile 可扫漏洞（无 package.json）。

### 提交门禁现状
- CI 侧：preflight.sh（payload 源、翻译哨兵、支持边界、release-state 等）+ node --test + 原生兼容验证，较完备。
- 本地侧：无任何 git hooks；门禁不可一条命令本地复现（preflight 部分项需 CI 环境变量）。

## 4. 改造批次划分

| 批次 | 覆盖业务域 | 主要目标 | 依赖前置 | 回滚方案 |
|---|---|---|---|---|
| 批次 1 | 文档体系 | 阶段 2 全部：AGENTS.md 重写、ARCHITECTURE.md、docs/index.md、QUALITY_SCORE.md、core-beliefs.md、旧计划归档 | 计划确认 | `git revert` 文档提交；不影响代码 |
| 批次 2 | 门禁与工具链 | 阶段 3：lint 方案（D2）、本地 pre-push hook、文档 lint、发布防呆校验、marketplace 版本核对（TD-VER-001） | 批次 1（文档索引存在后文档 lint 才可校验） | 逐 hook/lint 可独立关闭；CI 配置单独 revert |
| 批次 3 | 安装器与 patch 引擎重构 | 阶段 4：install.sh heredoc 下沉（TD-COMPLEX-001）、patch-cli.js 拆分（TD-COMPLEX-003）、巨型测试拆分（TD-COMPLEX-004）。~~sh/ps1 收敛~~ D3 已决策不收敛，改为批次 2 的成对变更检查门禁 | 批次 2（护栏就位）+ 现有 smoke/注册测试作为行为守恒对拍 | 每子任务独立提交可单独 revert；payload 同步机制保持字节一致 |
| 批次 4 | 测试度量与补全 | 阶段 5：覆盖率工具接入（D4）、覆盖率门禁、跳过用例登记清理（TD-QA-005）、结构测试 | 批次 3 完成（度量在重构后代码上） | 门禁阈值可调；测试新增不影响业务代码 |

## 5. 五阶段任务拆解

### 阶段 1 · 全量扫描与问题清单（本阶段）
- 子任务 1-12 已完成；产出物：本文档、`docs/exec-plans/tech-debt-tracker.md`、`docs/CI.md`；未编写独立分析脚本（度量由 awk/wc/grep/node --test 一次性命令完成，命令已记录在台账证据列）。
- 验收：计划获人工确认；`git diff --stat` 证明未改业务代码。

### 阶段 2 · 文档对齐
- 子任务：重写 AGENTS.md（附录 E 骨架，≤100 行，补常用命令）；CLAUDE.md 收敛为指针；新建 ARCHITECTURE.md（按 §3 诊断的依赖图落盘+依赖方向规则）；docs/index.md 全量索引；core-beliefs.md（附录 F + 本项目特有：翻译数据单一数据源、root→plugin 负载同步、零 npm 依赖特性）；QUALITY_SCORE.md（按 5 个领域打分：安装器/patch 引擎/插件负载/守护脚本/文档）；docs/plans 3 份旧计划移入 completed/ 归档（先标注来源）；工程化说明补全（本地开发/测试/发布/排障）。
- 产出物：上述文件 + 文档 lint 脚本（批次 2 接入 CI）。
- 可机械检查的验收：AGENTS.md ≤200 行；index.md 链接全部可解析（脚本校验）；抽样 3 份文档与代码一致；QUALITY_SCORE 每域有分数与依据。

### 阶段 3 · 门禁审计与自动化质量校验
- 不执行 §3.3 三问（非 Tauri，已记录 docs/CI.md）。
- 子任务：lint/格式化方案落地（受 D2）；pre-push 本地门禁（一条命令 = preflight 本地子集 + node --test 快速集）；文档 lint（死链/必填节/index 完整性）；发布防呆（版本对齐 pre-push 校验，TD-REL-001）；marketplace.json 版本字段核对（TD-VER-001）；门禁清单文档（每项：检查名/触发/失败含义/修复指引）；豁免机制（显式+原因+到期）。
- 验收（实测）：故意引入死链 → 文档 lint 失败；故意制造版本漂移 → 校验失败；干净环境一条命令跑通本地门禁。

### 阶段 4 · 问题修复与重构
- 批次 3 范围内，每子任务独立提交：① install.sh node heredoc 下沉 scripts/（153 行函数拆解）；② sh/ps1 收敛按 D3 决定执行范围；③ patch-cli.js 按职责拆分（同步更新 sync-payload）；④ 巨型测试文件按主题拆分。
- 行为守恒证据：每步前后跑全量 node --test + install-smoke；payload 复制保持 diff 为空。
- 验收：复杂度前后数值对比（文件行数/最大函数行数）；重复度量下降；门禁全绿。

### 阶段 5 · 测试补全与门禁接入
- 覆盖率工具接入（D4）→ 出基线报告 → 设整体+关键模块（patch-cli、native-repair、hooks）下限 → 缺口补测试；跳过用例登记/清理；结构测试（文件大小上限、payload 一致性已有、文档新鲜度）。
- 验收：故意破坏实现时新增测试失败（抽样 ≥3）；覆盖率达标；连续 3 次全量无失败；注入缺陷被门禁拦截（实测）。

## 6. 待人工决策清单

| 编号 | 问题 | 为什么需要人判断 | 影响范围 |
|---|---|---|---|
| D1 | ~~是否生成 GitHub CI / 平台 / 发布方式~~ | **已不适用**：框架判定为其他类型（§3.4），无需提问 | 阶段 3 |
| D2 | 是否引入 `package.json` 承载 lint/coverage 工具链？ | **已决策（2026-10-12）：不引入**。保持零依赖特色，lint/检查工具自研小脚本 | 阶段 3 |
| D3 | install.sh / install.ps1 双实现是否收敛？ | **已决策（2026-10-12）：保持双实现 + 加「改动必须成对」自动检查**（工作量小、风险低） | 批次 3 不再含收敛重构 |
| D4 | 覆盖率工具选型 | **已决策（2026-10-12）：Node 内置 `--experimental-test-coverage`**（零依赖） | 阶段 5 |
| D5 | 7 个跳过测试的处理 | **已决策（2026-10-12）：先登记原因，不强行修** | 阶段 5 |

## 7. 进度与决策日志

| 日期 | 阶段 | 动作 | 关联 commit | 决策与理由 |
|---|---|---|---|---|
| 2026-10-12 | 1 | 全量扫描；产出计划/台账/CI.md；建 harnessing 分支 | c9c3b46 | 框架判定=其他；跳过三问；现有 CI 仅审计 |
| 2026-10-12 | 1 | 用户确认 D2-D5 决策 | c4cb686 | D2=不引入 package.json（零依赖自研脚本）；D3=保持双实现+成对变更检查门禁；D4=node 内置覆盖率；D5=跳过测试先登记不修 |
| 2026-10-12 | 4 | 批次 3a 完成（install.sh 1492→1299 行，最大函数 153→61，新增测试 15 例）；3b/3c 经评估后用户决策延期并豁免 | cba40a9 等 7 个提交 | 3b 拆分 patch-cli.js 需协调 payload/发布链路 6+ 处，成本>收益；阶段 2 所定「超1000行文件 ≤2」目标不现实，修正为「最大函数行数 ≤60」（已达 61） |
| 2026-10-12 | 3 | 批次 2 门禁落地：check-file-size/check-version-alignment/check-sh-ps1-pair/check-doc-links + check-all.sh + pre-push 钩子 + ci.yml 4 步骤 + docs/GATES.md | （本次提交） | D2=自研脚本；D3=成对检查含 pair-exempt 豁免；豁免统一走 gate-exemptions.json（reason+expires） |
| 2026-10-12 | 2 | 批次 1 文档对齐：AGENTS.md 重写、CLAUDE.md 收敛、ARCHITECTURE.md、docs/index.md、core-beliefs.md、QUALITY_SCORE.md、旧计划归档、文档死链校验脚本+测试 | 4117c19 / a1904b3 / 62dc633 / （本次提交） | 文档 lint 用零依赖自研脚本（D2）；负向实测通过（死链/缺节均 exit 1 且报错含修复指引） |
