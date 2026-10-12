#!/usr/bin/env node
/**
 * reconcile-standalone-hooks.js — 协调独立备用 Hook 与官方插件入口
 *
 * 从 install.sh 的 reconcile_standalone_hooks 内嵌 heredoc 逐字抽离（行为守恒，批次 3a）。
 * 输入（env）：ZH_CN_SETTINGS / ZH_CN_PLUGIN_DST / ZH_CN_PLUGIN_RUNTIME_MODE / ZH_CN_OFFICIAL_PLUGIN_ID
 * 行为：清理遗留 standalone hook；mode=standalone 时写入备用 hook 三元组并停用官方入口；
 *       mode=official-retry 时重新启用官方入口；settings 非法时 exit 2。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const settingsFile = process.env.ZH_CN_SETTINGS;
const pluginRoot = process.env.ZH_CN_PLUGIN_DST;
const mode = process.env.ZH_CN_PLUGIN_RUNTIME_MODE;
const officialPluginId = process.env.ZH_CN_OFFICIAL_PLUGIN_ID;
const standaloneArg = "--standalone";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStandaloneHook(hook) {
  if (!isObject(hook)) return false;
  if (typeof hook.command === "string" && hook.command.includes("ZH_CN_STANDALONE_HOOK=1")) return true;
  if (hook.command !== "node" || !Array.isArray(hook.args) || !hook.args.includes(standaloneArg)) return false;
  const script = String(hook.args[0] || "");
  return script === path.join(pluginRoot, "hooks", "session-start.js") ||
    script === path.join(pluginRoot, "hooks", "notification.js") ||
    script === path.join(pluginRoot, "hooks", "user-prompt-submit.js");
}

function resolveCommitTarget(file) {
  try {
    return fs.realpathSync(file);
  } catch {}
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      return path.isAbsolute(link) ? link : path.resolve(path.dirname(file), link);
    }
  } catch {}
  return path.resolve(file);
}

function commitSettings(file, content) {
  const target = resolveCommitTarget(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let mode = 0o600;
  try { mode = fs.statSync(target).mode & 0o777; } catch {}
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.zh-cn-hooks.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(temp, content, { mode });
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, target);
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
}

const raw = fs.readFileSync(settingsFile, "utf8").replace(/^\uFEFF/, "");
const settings = raw.trim() ? JSON.parse(raw) : {};
if (!isObject(settings)) process.exit(2);

let changed = false;
if (isObject(settings.hooks)) {
  for (const eventName of Object.keys(settings.hooks)) {
    const entries = settings.hooks[eventName];
    if (!Array.isArray(entries)) continue;
    const nextEntries = [];
    for (const entry of entries) {
      if (!isObject(entry) || !Array.isArray(entry.hooks)) {
        nextEntries.push(entry);
        continue;
      }
      const hooks = entry.hooks.filter((hook) => !isStandaloneHook(hook));
      if (hooks.length !== entry.hooks.length) changed = true;
      if (hooks.length > 0) nextEntries.push(hooks.length === entry.hooks.length ? entry : { ...entry, hooks });
    }
    if (nextEntries.length > 0) settings.hooks[eventName] = nextEntries;
    else delete settings.hooks[eventName];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

if (mode === "standalone") {
  if (!isObject(settings.enabledPlugins)) settings.enabledPlugins = {};
  settings.enabledPlugins[officialPluginId] = false;
  if (!isObject(settings.hooks)) settings.hooks = {};
  const sessionScript = path.join(pluginRoot, "hooks", "session-start.js");
  const notificationScript = path.join(pluginRoot, "hooks", "notification.js");
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
  if (!Array.isArray(settings.hooks.Notification)) settings.hooks.Notification = [];
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];
  const userPromptScript = path.join(pluginRoot, "hooks", "user-prompt-submit.js");
  settings.hooks.SessionStart.push({
    matcher: "startup|resume|clear|compact",
    hooks: [{ type: "command", command: "node", args: [sessionScript, standaloneArg], async: false }],
  });
  settings.hooks.Notification.push({
    matcher: "",
    hooks: [{ type: "command", command: "node", args: [notificationScript, standaloneArg], async: false, timeout: 10 }],
  });
  settings.hooks.UserPromptSubmit.push({
    matcher: "",
    hooks: [{ type: "command", command: "node", args: [userPromptScript, standaloneArg], async: false, timeout: 120 }],
  });
  changed = true;
}

if (mode === "official-retry") {
  if (!isObject(settings.enabledPlugins)) settings.enabledPlugins = {};
  settings.enabledPlugins[officialPluginId] = true;
  changed = true;
}

if (changed) commitSettings(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
