# 测试策略（TESTING）

> 测试分层、运行方式、跳过登记、覆盖率门禁与已知缺口。

## 分层与运行

| 层 | 范围 | 命令 | 时长上限 |
|---|---|---|---|
| 单元 | `scripts/*.js`、`plugin/hooks/*.js`、patch 引擎 | `node --test tests/<name>.test.js` | 单文件 < 10s |
| 集成 | install.sh / uninstall.sh 端到端（fake claude、临时 HOME、真 sqlite3） | `node --test tests/install-smoke.test.js tests/plugin-registration.test.js tests/ccswitch-sync.test.js` | < 90s |
| 全量 | 全部 | `node --test tests/` | < 120s（实测 ~35s） |

规则：用例名描述行为；不使用魔法数字；不依赖执行顺序；测试即文档。

## 跳过用例登记（决策 D5：显式登记，不强行修）

截至 2026-10-12 共 **7 个**，全部为平台条件跳过，**由 Windows CI job 覆盖**，恢复条件=在 Windows 环境运行：

| 用例 | 位置 | 跳过原因 | 恢复条件 |
|---|---|---|---|
| install.ps1 patches Windows old npm cli.js representatives | tests/install-smoke.test.js | requires Windows PowerShell | Windows CI（windows-install-smoke job） |
| install.ps1 skips Windows native exe | 同上 | 同上 | 同上 |
| Windows binary remove waits for release | 同上 | 同上 | 同上 |
| Windows binary replace waits for release | 同上 | 同上 | 同上 |
| Windows write guard waits for transient sharing | 同上 | 同上 | 同上 |
| Windows session-start hook writes spinner tips to CLAUDE_CONFIG_DIR | tests/session-start-hook.test.js | requires Windows PowerShell | 同上 |
| Windows session-start hook preserves UTF-8 Chinese in redirected stdout | 同上 | SKIP（Windows 专项） | 同上 |

新增跳过用例必须在本表登记（原因+恢复条件），否则视为违规（core-beliefs #20）。

## 覆盖率门禁（决策 D4：node 内置，零依赖）

- 入口：`node scripts/check-coverage.js`（跑全量+校验）；`--lcov <file>` 校验已有报告；`--report` 只打印。
- 阈值：`scripts/coverage-thresholds.json`。基线 2026-10-12：整体 行 79.49 / 分支 69.17 / 函数 74.12（43 个仓库内源文件）。
- 只统计仓库内源码；`tests/` 与测试临时目录 fixture（`../` 路径）不计入。
- 调低阈值必须在 PR 描述中说明理由。

## 已知覆盖缺口（登记，非豁免）

| 位置 | 行覆盖 | 原因 | 处置 |
|---|---|---|---|
| `scripts/native-repair.js` | 13.5% | 完整路径需真实 native binary 与 node-lief 环境；部分经 install smoke 间接覆盖 | 后续补可注入的单元测试（批次外，跟踪于 TD-QA-001 历史记录） |
| `plugin/hooks/session-start.js` | 不计入 | 测试在临时目录副本上运行（设计使然：hook 行为依赖安装后布局） | 保持现状；其副本覆盖率由 session-start-hook.test.js 保证 |
| `install.ps1` Windows 路径 | 不可测（本机） | 需 Windows PowerShell | Windows CI 覆盖 |

## 结构测试（架构约束的机械校验）

- `node scripts/check-structure.js`：安装脚本不得再出现长大 heredoc（批次 3a 成果防回退）；仓库源码不得 `require` 仓库外路径（payload 自包含）。
- 详见 docs/GATES.md。

## 门禁实测记录（负向注入证据，防「假门禁」）

> 每个新门禁必须证明「注入缺陷时真的会失败」，只看配置不算验收（§5 阶段 3 硬要求）。
> 本节登记实测结果；复现方式见各测试文件的负向用例。

| 门禁 | 注入的缺陷 | 实测结果 | 复现位置 |
|---|---|---|---|
| 覆盖率 floor（TD-QA-007） | lcov 里放一个 10% 覆盖的文件 | exit 1，点名文件 | `tests/coverage-gate.test.js` |
| 覆盖率 floor 豁免过期 | `floor.exempt` 的 expires 改成 2020-01-01 | exit 1，报「豁免已过期」 | 同上 |
| sh/ps1 成对（含 hook） | 只改 `session-start.ps1` 一端 | exit 1，报错含修复指引 | 2026-10-13 手工实测（临时提交后回滚） |
| plugin 负载副本一致性 | 给 `plugin/patch-cli-localizations.js` 追加一行 | exit 1 | `tests/plugin-payload.test.js` |
| 临时目录守卫（TD-QA-008） | 在 `tests/doctor.test.js` 重新引入裸 `mkdtempSync` | exit 1，报告 1 处待迁移 | `node scripts/migrate-tmpdir.js --check` |
| 翻译数据源守护 | （由 `tests/settings-sources.test.js` 守护） | 负向用例存在 | `tests/settings-sources.test.js` |
| **文档园丁（2026-10-13）** | `QUALITY_SCORE.md` 用例数改 545→999 | exit 1，报「声称 999 用例，实际 553」 | `tests/doc-freshness.test.js` |
| **文档园丁** | 真实口径覆盖率改 85.54→11.11 | exit 1，且 `--write` 只改目标行（对照口径 79.92% 未被误改） | 同上 |
| **文档园丁** | `GATES.md` 某门禁「触发」列去掉 check-all | exit 1，报「未登记」 | 同上 |
| **文档园丁** | 删掉 `QUALITY_SCORE.md` / `GATES.md` | exit 1，报带「修复：」的指引而非 ENOENT 堆栈 | 同上 |

## 文档园丁（2026-10-13 新增，§8.2 doc-gardening）

- `node scripts/check-doc-freshness.js`：校验 `QUALITY_SCORE.md` 的可复算数字与 `GATES.md` 的本地门禁清单是否仍与代码一致；数字类漂移 `--write` 自动修复。
- **能力边界**：只校有唯一真相来源的数字。主观评分、结论性描述、测试耗时、分支/函数覆盖率逐项值**不校**——理由见 `docs/GATES.md`「文档园丁的能力边界」。
- 上线即抓到 3 处真实漂移（用例数 545→553、patch-cli.js 1938→1135 行、覆盖率停在 TD-QA-006 修正前），已全部修复。
- 跑一轮约 40s（内部要跑全量测试取真相），由 `check-all.sh` 带上，不必单独运行。
