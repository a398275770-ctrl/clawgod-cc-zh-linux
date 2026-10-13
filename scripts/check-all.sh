#!/usr/bin/env bash
# check-all.sh — 本地一条命令复现全部门禁（提交前/推送前自检）
#
# 用法：
#   bash scripts/check-all.sh           # 全量（含测试，约 40s）
#   bash scripts/check-all.sh --fast    # 快速（跳过 node --test，约 2s）
#   SKIP_TESTS=1 bash scripts/check-all.sh   # 同 --fast
#
# 各检查项说明见 docs/GATES.md。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1
[ "${SKIP_TESTS:-0}" = "1" ] && FAST=1

FAILED=0

run() {
  local name="$1"; shift
  echo "── $name"
  if "$@"; then
    echo "   ✓ 通过"
  else
    echo "   ✗ 失败（修复指引见上方输出或 docs/GATES.md）"
    FAILED=1
  fi
}

run "文档死链/必填节"        node scripts/check-doc-links.js
run "文件大小上限"           node scripts/check-file-size.js
run "版本声明点对齐"         node scripts/check-version-alignment.js
run "翻译数据源守护"         node scripts/verify-settings-sources.js
run "文档派生计数同步"       node scripts/sync-doc-derived-counts.js --check
run "结构约束（S1/S2）"      node scripts/check-structure.js

# sh/ps1 成对变更：仅在能解析 base 时检查（本地无 origin/main 时跳过并提示）
if git rev-parse --verify origin/main >/dev/null 2>&1; then
  run "sh/ps1 成对变更"      node scripts/check-sh-ps1-pair.js --base origin/main
else
  echo "── sh/ps1 成对变更：跳过（本地无 origin/main；CI 中会检查）"
fi

# 负载一致性：根 6 文件与 plugin/ 副本必须逐字节一致
run "plugin 负载一致性"      bash -c '
  for f in patch-cli.sh patch-cli.js cli-translations.json bun-binary-io.js compute-patch-revision.sh settings-overlay.json; do
    cmp -s "$f" "plugin/$f" || { echo "负载不一致: $f ↔ plugin/$f —— 修复：bash scripts/sync-payload.sh"; exit 1; }
  done
'

if [ "$FAST" = "0" ]; then
  run "全量测试"             node --test tests/
  run "覆盖率门禁"           node scripts/check-coverage.js
else
  echo "── 全量测试+覆盖率：跳过（--fast / SKIP_TESTS=1）"
fi

echo ""
if [ "$FAILED" = "1" ]; then
  echo "check-all: 存在失败项，请按上方修复指引处理后重试。"
  exit 1
fi
echo "check-all: 全部通过 ✓"
