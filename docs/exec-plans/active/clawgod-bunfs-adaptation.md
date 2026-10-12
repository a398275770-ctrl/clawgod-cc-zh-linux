# 执行计划：clawgod / bunfs 安装形态适配

## 0. 元信息
- 项目 / 仓库：claude-code-zh-cn（本地 harnessing 分支）
- 计划版本 / 日期：v1 / 2026-10-12
- 状态：待确认
- 类型：**新增功能（行为变更）**——与 harness 改造（行为守恒）无关，独立提交、独立验收

## 1. 背景与目标

**现状**：本机 clawgod 封装官方 Claude Code 2.1.296——`claude` 是 bash launcher，bun 执行 `~/.clawgod/cli.cjs`，真实 UI 代码在 `~/.clawgod/bunfs/chunk-*.js`（2341 个 chunk）。上游 `bun-binary-io.js detect` 三条路径（npm cli.js / native binary / npm exe）均不命中 bunfs 布局 → `unknown` → CLI Patch 跳过，2314 条 UI 汉化不生效。settings/hook/spinner 三层与形态无关，不受影响。

**目标**：新增第四种安装形态 `clawgod-bunfs`，使 UI 文字 patch 在 clawgod 环境完整生效，并纳入本仓库的备份/回滚/重 patch/卸载/支持矩阵体系。

**非目标**：不改 clawgod 本体；不动 native/npm 既有路径；不做 clawgod 版本管理。

## 2. 方案设计

### 2.1 检测（scripts/bun-binary-io.js 或新 scripts/detect-clawgod.js）

判定条件（全部满足）：
1. 存在 `$CLAWGOD_DIR/bunfs` 目录（`CLAWGOD_DIR` 默认 `~/.clawgod`，可用 env 覆盖）
2. 存在 `$CLAWGOD_DIR/cli.cjs`
3. `bunfs` 下存在 `chunk-*.js`

输出形态：`clawgod-bunfs:<bunfs目录>`，与既有 `npm:` / `native-bun:` 形态并行进入 `install.sh` 的 `detect_installation` 分派。

版本识别：读 `$CLAWGOD_DIR/.source-version`（无则报 `unknown`，按上游惯例走本机自验证）。

### 2.2 Patch 路径（新 scripts/patch-bunfs.js）

复用现有引擎，**不改 `patch-cli.js`**：
1. 枚举 `bunfs/chunk-*.js`
2. 逐 chunk 用 `patch-cli.js` 的替换逻辑 dry-run 统计命中数；命中 0 的 chunk 跳过（绝大多数 chunk 不含 UI 文案，实测预期命中 ~250/2341）
3. 命中 chunk 的处理顺序：备份 → patch → `node --check` 语法校验 → 失败回滚该 chunk
4. 指纹标记：写入 `$CLAWGOD_DIR/.zh-cn-patched`（版本 + patch revision，复用 `compute-patch-revision.sh`）
5. 任一 chunk 失败仅回滚该 chunk，整体降级为"部分汉化"，CLI 永远可用（core-beliefs #17）

### 2.3 备份与回滚

- 备份目录：`$CLAWGOD_DIR/bunfs.zh-cn-backup/`，按 chunk 名镜像存放原始文件
- 同版本重复 patch：先按指纹判断是否已 patch，避免叠 patch
- `uninstall.sh` 新增 clawgod 分支：从备份恢复全部命中 chunk，删除标记文件
- clawgod 升级内核（chunk 被替换）→ 指纹不匹配 → session-start hook 触发重 patch（既有机制，hook 侧加 clawgod 检测分支）

### 2.4 文档与矩阵

- `docs/support-matrix.md`：新增 `clawgod-bunfs` 行（形态说明、已验证 2.1.296、本机自验证标注）
- `ARCHITECTURE.md` 平台矩阵加一行
- `AGENTS.md` 常用命令与硬约束不变（形态对使用者透明）

### 2.5 测试（全部用 fixture，不碰真实 ~/.clawgod）

1. `tests/clawgod-detect.test.js`：临时目录搭假 bunfs/cli.cjs → 检测通过；缺文件 → 不命中
2. `tests/patch-bunfs.test.js`：假 bunfs（含少量含 UI 文案的 chunk + 大量不含文案的 chunk）→ patch 后文案为中文、备份存在、语法校验通过
3. 回滚用例：patch 后跑恢复 → chunk 字节级还原
4. 失败降级用例：某 chunk patch 后语法非法（构造非法译文场景）→ 该 chunk 回滚、其余保留、退出码非 0 但 CLI 形态可用
5. 指纹用例：重复 patch 幂等；版本变化触发重 patch

## 3. 改造批次

| 批次 | 内容 | 验收 |
|---|---|---|
| 批次 A | detect 脚本 + install.sh/uninstall.sh 分派 + 指纹标记 | detect 测试 + install-smoke 全过 |
| 批次 B | patch-bunfs.js（复用引擎）+ patch/回滚/降级测试 | patch-bunfs 测试全过 + 全量 531 用例 0 失败 |
| 批次 C | session-start hook 重 patch 分支 + doctor 支持 + 文档/矩阵 | hook 测试 + 文档 lint 过 |

每批次独立提交；批次间全量测试保持 0 失败。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| patch chunk 后 bun 加载行为差异（bunfs 是 bun 运行时的虚拟文件系统） | patch 前后 `node --check` + 实机验证（装完跑一次 `claude --version` 与简单会话）；先在本机 2.1.296 自验证再标矩阵 |
| clawgod 升级后 chunk 哈希全变 | 指纹按版本+revision 匹配，不匹配即重 patch（既有机制） |
| 2341 chunk 全扫性能 | dry-run 仅字符串 `includes` 预筛，预期秒级 |
| 与上游合并冲突（若将来推上游） | 检测逻辑独立成文件，diff 面小；命名中性化见 D6 |

## 5. 待人工决策

| 编号 | 问题 | 影响 |
|---|---|---|
| D6 | 命名中性化：检测逻辑写成通用的 `bunfs-layout`（任何 bun 散块分发都可用）还是 clawgod 专属？中性化利于贡献上游，但增加未验证面的承诺 | 代码命名、文档措辞、上游接受度 |
| D7 | clawgod 形态的 patch 默认开启还是 `ZH_CN_CLAWGOD_PATCH=1` opt-in？clawgod 是非官方封装，默认开启等于对未经上游验证的环境做写入；opt-in 更保守但多一步 | install.sh 默认行为 |

## 6. 进度与决策日志

| 日期 | 批次 | 动作 | 关联 commit | 决策与理由 |
|---|---|---|---|---|
| 2026-10-12 | — | 立项（背景实测：detect=unknown，bunfs 2341 chunk，2.1.296 超官方窗口） | （本次提交） | 复用 patch-cli.js 引擎；不动 clawgod 本体 |
