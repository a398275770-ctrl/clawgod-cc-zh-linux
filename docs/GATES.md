# 门禁清单（GATES）

> 每项门禁：检查名、触发时机、失败含义、修复指引、豁免方式。
> 总入口：本地 `bash scripts/check-all.sh`（推送前经 pre-push 钩子自动执行）；CI 在 `.github/workflows/ci.yml` 的 test job。

## 本地复现

```bash
bash scripts/check-all.sh           # 全量（约 40s，含测试）
bash scripts/check-all.sh --fast    # 快速（跳过 node --test）
bash scripts/install-git-hooks.sh   # 安装 pre-push 钩子（推送前自动跑全量）
```

## 既有门禁（改造前已存在）

| 检查 | 入口 | 触发 | 失败含义 | 修复指引 |
|---|---|---|---|---|
| PR preflight（payload 源守护/翻译哨兵/支持边界等） | `bash scripts/preflight.sh --base <ref>` | CI：PR | 负载与源不一致、译文哨兵缺失等 | 按各项报错输出；负载问题跑 `bash scripts/sync-payload.sh` |
| main preflight | `bash scripts/preflight.sh --skip-payload-source --skip-release-state` | CI：push main | 同上（跳过 PR 专属项） | 同上 |
| 发布状态校验 | `bash scripts/preflight.sh --release-state` | 发布收尾人工执行 | manifest/CHANGELOG/tag/Release 未对齐 | 按 CLAUDE.md「版本发布流程」补齐 |
| 派生计数同步 | `node scripts/sync-doc-derived-counts.js --check` | CI + check-all | README/AGENTS/CLAUDE 中计数锚点过期 | `node scripts/sync-doc-derived-counts.js --write` |
| 全量测试 | `node --test tests/` | CI（各平台 job）+ check-all | 行为回归 | 按失败用例定位；不得为通过而改测试 |
| PR 自动关闭关键词 | `node scripts/check-pr-autoclose-keywords.js` | CI：PR | PR body 含误用关闭关键词 | 修改 PR 描述 |

## 新增门禁（harness 改造批次 2，2026-10-12）

| 检查 | 入口 | 触发 | 失败含义 | 修复指引 | 豁免 |
|---|---|---|---|---|---|
| 文档死链/必填节 | `node scripts/check-doc-links.js` | CI + check-all | 索引/入口文档存在死链或缺必填节 | 报错含逐条修复指引；结构性调整需同步改 `REQUIRED_SECTIONS` | 无（结构问题不应豁免） |
| 文件大小上限（T1） | `node scripts/check-file-size.js` | CI + check-all | js/sh/ps1 文件超 2000 行 | 按职责拆分（见 ARCHITECTURE.md「依赖方向规则」） | `scripts/gate-exemptions.json` 登记（reason+expires，过期自动失效） |
| 版本声明点对齐 | `node scripts/check-version-alignment.js` | CI + check-all | manifest.json / plugin.json / CHANGELOG 顶部版本不一致 | 按 CLAUDE.md 发布流程同步 3 处 | 无 |
| 翻译数据源守护 | `node scripts/verify-settings-sources.js` | CI + check-all | `settings-overlay.json` 含 `spinnerVerbs`/`spinnerTipsOverride`，或 verbs/tips 结构非法 | 把数据移回 `verbs/zh-CN.json` / `tips/zh-CN.json`（core-beliefs #14 单一数据源） | 无 |
| 临时目录无裸创建（TD-QA-008） | `node scripts/migrate-tmpdir.js --check` | CI + check-all | `tests/*.test.js` 出现裸 `fs.mkdtempSync(path.join(os.tmpdir(), ...))` | 改用 `mkTmpDir(prefix)`（`tests/helpers/tmpdir.js`，进程退出自动清理）；批量迁移：`node scripts/migrate-tmpdir.js` | 无 |
| sh/ps1 成对变更（D3） | `node scripts/check-sh-ps1-pair.js --base <ref>` | CI：PR + check-all | 双端实现只改了一端 | 把同一逻辑同步到另一端 | commit message 含 `pair-exempt: <原因>` |
| plugin 负载一致性 | `bash scripts/check-all.sh`（内嵌） | check-all（pre-push） | 根 6 文件与 plugin/ 副本不一致 | `bash scripts/sync-payload.sh` | 无 |
| 结构约束（S1 安装脚本禁长 heredoc / S2 禁仓库外引用） | `node scripts/check-structure.js` | CI + check-all | 架构约束被违反（批次 3a 成果回退或 payload 不自包含） | 报错含逐条修复指引 | 无 |
| 文档新鲜度（园丁，2026-10-13） | `node scripts/check-doc-freshness.js` | CI + check-all | ①`QUALITY_SCORE.md` 的测试用例数/文件行数/真实口径覆盖率与现算不符；②`GATES.md` 登记的本地门禁与 `check-all.sh` 实际步骤不符 | 数字类：`node scripts/check-doc-freshness.js --write` 自动修；清单类：按提示补登记或把「触发」列改回实际范围 | 无 |
| 覆盖率门禁（D4 + TD-QA-006/007） | `node scripts/check-coverage.js` | CI + check-all 全量模式 | ①整体/关键模块低于阈值；②任一源文件行覆盖低于 `floor.minLineRate`；③`floor.exempt` 豁免已过期 | 补测试；阈值不合理时改 `scripts/coverage-thresholds.json` 并在 PR 说明；确属无法单测的在 `floor.exempt` 登记 `{reason, expires}` | `floor.exempt`（reason + expires 必填，到期自动恢复拦截） |

### 文档园丁的能力边界（2026-10-13）

`check-doc-freshness.js` 是 §8.2 的 doc-gardening 机械化落地，但**只校验有唯一真相来源的数字**：

| 校验 | 真相来源 |
|---|---|
| 测试用例数 | `node --test tests/` 输出 |
| install.sh / install.ps1 / patch-cli.js 行数 | `wc -l` |
| install.sh 最大函数行数 | awk 函数度量 |
| 真实口径行覆盖率 | `check-coverage.js --report` |
| 本地门禁清单 | 解析 `check-all.sh` 的 run 步骤 |

**不校验**：主观评分、结论性描述、测试耗时、以及「为什么这么设计」的叙述——那些是人的事，机械校验只会制造假精确。覆盖率只校行覆盖率一个维度（分支/函数与关键模块逐项值随时可 `--report` 复算，写进文档反而必然漂移）。

跑一轮约 40s（内部要跑全量测试取真相）。日常不必主动跑，`check-all.sh` 会带上。

### 覆盖率口径说明（TD-QA-006，2026-10-13 修正）

`plugin/` 下与根**字节一致**的负载副本不再双计（`isPayloadMirror`）。此前 `patch-cli.js`、`bun-binary-io.js`、`scripts/detect-clawgod.js` 各被根与副本计两次，副本口径把整体拉低约 5.5pp。修正后真实口径行覆盖 85.54%（48 文件）；含副本的对照口径为 79.92%（51 文件）。有意保留差异的副本（如 `plugin/scripts/install-json-helper.js` 的 require 路径适配）仍独立统计。

### 不在机械校验范围的事项（2026-10-13 明确）

- **反触号路径引用**（如文档里写 `` `scripts/check-all.sh` ``）：全仓混用「相对仓库根」与「相对文档所在目录」两种约定，机械解析无法区分（实测 86 处命中多为合法路径误判）。已删除 `check-doc-links.js --strict` 死代码，该类引用靠 code review 保证（TD-CI-002）。

## 豁免机制（统一约定）

1. 豁免必须**显式**：登记在 `scripts/gate-exemptions.json`（文件级）或写在 commit message（pair-exempt）。
2. 必须带**原因**；文件级豁免必须带**到期时间**（`expires: YYYY-MM-DD`），过期自动恢复拦截。
3. 豁免清单纳入仓库版本管理，可在 `git log` 与 PR 中审计（core-beliefs #20）。

## 合并理念

- 最小阻塞式：门禁只拦真正的危险（不一致、回归、越界），不拦风格偏好。
- 偶发失败（网络/上游探活类）优先重跑，不无限阻塞；确定性失败必须修根因。
