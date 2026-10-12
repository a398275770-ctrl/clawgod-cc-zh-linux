# ARCHITECTURE.md

> 顶层地图：领域划分、数据流、依赖方向规则。细节下推到各文件头部注释与 `docs/`。

## 领域划分

| 领域 | 位置 | 职责 |
|---|---|---|
| 安装器（Installer） | `install.sh` / `install.ps1` / `uninstall.*` / `install-remote.sh` | 编排安装全流程：settings 合并、插件负载同步、插件注册、launcher 注入、触发首次 Patch |
| Patch 引擎（Patcher） | `patch-cli.sh` / `patch-cli.js` | 对 cli.js 硬编码英文做字符串字面量安全替换；含备份、语法校验、失败回滚 |
| 原生二进制 IO（Native IO） | `bun-binary-io.js` / `scripts/patch-bytecode.js` | bun 编译二进制（Mach-O/ELF/PE）的 JS 提取与写回；Windows bytecode 常量池补丁 |
| 插件负载（Plugin Payload） | `plugin/` | 官方插件市场形态：manifest、hooks、commands、output-styles、skills + 根文件的负载副本 |
| 翻译数据（Data） | `cli-translations.json` / `verbs/zh-CN.json` / `tips/zh-CN.json` | 全部译文；verbs/tips 是唯一数据源 |
| Skill 汉化管道（skill-i18n） | `plugin/skill-i18n/` | 独立子系统：翻译用户已装 skill/命令的 description（默认禁用，`ZH_CN_SKILL_I18N_ENABLE=1` 开启） |
| 守护与验证（Guards） | `scripts/`（preflight、check-*、verify-*、generate-*） | 提交门禁、上游兼容验证、支持矩阵生成、发布状态校验 |
| 测试（Tests） | `tests/` | node:test 套件，492 用例 |

## 数据流

```text
verbs/zh-CN.json ─┐
tips/zh-CN.json ──┴─ install.sh 现场组装 ──> ~/.claude/settings.json
cli-translations.json ──> patch-cli.js ──> 目标 CLI（npm cli.js / native binary / bytecode）

根 6 文件（源）── scripts/sync-payload.sh 复制 ──> plugin/（副本，CI 守护一致性）

session-start hook ──检测 Claude Code 更新──> 指纹比对(compute-patch-revision.sh) ──> 自动重 patch
user-prompt-submit hook ──> /chinese /english 会话内切换
```

## 依赖方向规则（机械可检查的目标）

1. **编排层不内嵌业务逻辑**：`install.sh`/`install.ps1` 只做流程编排；业务逻辑必须下沉为 `scripts/` 下的独立 Node 脚本（可单测）。现状违反处已登记 TD-COMPLEX-001，阶段 4 收敛。
2. **数据只能有一个源**：任何译文只允许从 `verbs/`、`tips/`、`cli-translations.json` 读出，不允许第二份手写副本（`settings-overlay.json` 禁含 verbs/tips）。
3. **`plugin/` 不独立演化**：负载文件只由 `sync-payload.sh` 从根复制，禁止直接改 `plugin/` 副本。
4. **Patch 引擎不依赖安装器**：`patch-cli.js` 可被 install.sh、session-start hook、native-repair 多方调用，不得反向引用安装器逻辑。
5. **skill-i18n 管道独立**：与 cli patch、spinner 翻译互不影响、互不引用。
6. **零 npm 依赖**：任何脚本只允许用 Node 内置模块与系统工具（bash/node/jq/sqlite3/node-lief 按需优雅降级）。

## 平台矩阵

| 形态 | 入口 | Patch 路径 |
|---|---|---|
| npm 全局安装 | `patch-cli.sh` | 直接改 cli.js（备份 + 语法校验 + 回滚） |
| 官方 native binary（macOS/Linux） | `scripts/native-repair.js` | `bun-binary-io.js` 提取 → patch-cli.js → 写回（macOS 含 codesign） |
| Windows bytecode | `scripts/patch-bytecode.js` | 字节码常量池占位内写入中文 |
| Windows npm | `install.ps1` | 同 npm 路径 |
| clawgod bunfs（第三方封装，D6/D7） | `scripts/detect-clawgod.js` + `scripts/patch-bunfs.js` | 逐 chunk 复用 patch-cli.js 引擎；备份/回滚按 chunk 维度；标记 `$CLAWGOD_DIR/.zh-cn-patched` |

版本支持窗口见 `docs/support-matrix.md`（由 `scripts/generate-support-matrix.js` 生成，禁止手改）。
