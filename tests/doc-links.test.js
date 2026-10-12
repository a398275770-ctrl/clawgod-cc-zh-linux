const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "check-doc-links.js");
const INDEX = path.join(REPO_ROOT, "docs", "index.md");

function runChecker() {
  return spawnSync("node", [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
}

test("doc-links: 当前仓库文档无死链、必填节齐全", () => {
  const r = runChecker();
  assert.strictEqual(r.status, 0, `应通过，实际输出：\n${r.stdout}\n${r.stderr}`);
});

test("doc-links: 注入死链时必须失败且报错含修复指引", () => {
  const original = fs.readFileSync(INDEX, "utf8");
  try {
    fs.writeFileSync(INDEX, original + "\n[dead](docs/definitely-not-exist.md)\n");
    const r = runChecker();
    assert.notStrictEqual(r.status, 0, "注入死链后应失败");
    assert.match(r.stderr, /DEAD LINK/, "应报告死链");
    assert.match(r.stderr, /修复：/, "错误信息必须含修复指令");
  } finally {
    fs.writeFileSync(INDEX, original);
  }
});

test("doc-links: 删除必填节时必须失败", () => {
  const original = fs.readFileSync(INDEX, "utf8");
  try {
    fs.writeFileSync(INDEX, original.replace("## 入口与规范", "## 改名了"));
    const r = runChecker();
    assert.notStrictEqual(r.status, 0, "缺必填节应失败");
    assert.match(r.stderr, /MISSING SECTION/, "应报告缺节");
  } finally {
    fs.writeFileSync(INDEX, original);
  }
});
