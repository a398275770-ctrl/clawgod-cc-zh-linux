#!/usr/bin/env bash
# install-git-hooks.sh — 安装本地 pre-push 钩子（零依赖，写入 .git/hooks/，不入库）
#
# 用法：bash scripts/install-git-hooks.sh [--uninstall]
# 钩子行为：git push 前跑 bash scripts/check-all.sh；失败则阻止推送。
# 紧急绕过：git push --no-verify（会在历史中留下痕迹，慎用）。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/.git/hooks/pre-push"
MARKER="# claude-code-zh-cn pre-push gate"

if [ "${1:-}" = "--uninstall" ]; then
  if [ -f "$HOOK" ] && grep -q "$MARKER" "$HOOK"; then
    rm "$HOOK"
    echo "已卸载 pre-push 钩子"
  else
    echo "未发现由本脚本安装的 pre-push 钩子，未动"
  fi
  exit 0
fi

if [ -f "$HOOK" ] && ! grep -q "$MARKER" "$HOOK" 2>/dev/null; then
  echo "已存在其他 pre-push 钩子，未覆盖。请手动把下行合并进去：" >&2
  echo "  bash scripts/check-all.sh || exit 1" >&2
  exit 1
fi

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# claude-code-zh-cn pre-push gate
# 由 scripts/install-git-hooks.sh 安装；卸载：bash scripts/install-git-hooks.sh --uninstall
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
bash scripts/check-all.sh || {
  echo "pre-push 门禁失败。紧急绕过：git push --no-verify（慎用）" >&2
  exit 1
}
EOF
chmod +x "$HOOK"
echo "已安装 pre-push 钩子 → $HOOK"
echo "推送前将自动执行 bash scripts/check-all.sh（约 40s）；--fast 模式：编辑钩子或设 SKIP_TESTS=1"
