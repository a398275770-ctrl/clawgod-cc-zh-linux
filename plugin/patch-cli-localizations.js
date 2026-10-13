#!/usr/bin/env node
/**
 * patch-cli-localizations.js — cli.js 结构化本地化补丁（从 patch-cli.js 抽离，2026-10-13）
 *
 * 背景：patch-cli.js 原 1955 行 / 50 函数，本文件容纳其中 23 个 install* 结构化补丁函数
 * （约 800 行）。抽离动机见 docs/exec-plans/completed/harness-migration-2026-10-13.md 的 D3 专项评估。
 *
 * 为什么是独立文件而不是函数拆分后就地重组：
 * patch-cli.js 是带顶层执行的脚本（非模块），被三路 spawn——patch-cli.sh、scripts/native-repair.js、
 * scripts/patch-bunfs.js，且被 sync-payload.sh 整份复制到 plugin/ 分发。保持"单入口 + 同目录模块"
 * 的形态，三路调用与分发链路都不需要改变调用方式（require 相对脚本自身解析，与 CWD 无关）。
 *
 * 依赖注入而非直接引用：tryReplace / tryRegexReplace 操作 patch-cli.js 的模块级状态
 * （cli.js 源码字符串 s 与替换计数 count），因此由调用方以闭包形式传入，本文件不持有该状态。
 *
 * 新增结构化补丁：在下方 STEPS 数组追加函数即可，patch-cli.js 的调度循环会自动执行，
 * 单个失败只跳过该项（记日志），不影响其余补丁与主流程。
 */

"use strict";

/**
 * 构造结构化补丁集合。
 * @param {{tryReplace: Function, tryRegexReplace: Function}} hooks 由 patch-cli.js 注入的替换原语
 * @returns {Array<{name: string, run: Function}>} 补丁步骤，按数组顺序执行
 */
function createLocalizationSteps({ tryReplace, tryRegexReplace, state }) {
    // state: { get(), set(v), bump() } — 个别补丁（installDurationFormatterLocalization）
    // 需直接读写 cli.js 源码与替换计数，无法经由 tryReplace/tryRegexReplace 表达。
    if (!state || typeof state.get !== "function" || typeof state.set !== "function" || typeof state.bump !== "function") {
        throw new Error("createLocalizationSteps 需要 state: { get, set, bump }");
    }
function installStatuslinePromptPathGuard() {
    const source =
        "Your job is to create or update the statusLine command in the user's Claude Code settings.\n\nWhen asked to convert the user's shell PS1 configuration, follow these steps:";
    const replacement =
        "Your job is to create or update the statusLine command in the user's Claude Code settings.\n\nPath handling for tools:\n- Use shell-relative paths exactly as written when calling tools: ~/.zshrc, ~/.bashrc, ~/.bash_profile, ~/.profile, and ~/.claude/settings.json.\n- Never invent or guess an absolute /Users/... path; the host resolves ~ for the current user.\n\nWhen asked to convert the user's shell PS1 configuration, follow these steps:";
    tryReplace(source, replacement);
}

function installStatuslineCommandPromptPathGuard() {
    const guard =
        " CRITICAL TOOL PATH RULE: use only ~/.zshrc, ~/.bashrc, ~/.bash_profile, ~/.profile, and ~/.claude/settings.json when calling Read, Edit, or Write; never use an absolute /Users/... path.";
    tryRegexReplace(
        /`Create an \$\{([^}]+)\} with subagent_type "statusline-setup" and the prompt "\$\{([^}]+)\}"`/g,
        (match, agentExpr, promptExpr) => {
            if (match.includes("CRITICAL TOOL PATH RULE")) {
                return match;
            }
            return (
                "`Create an ${" +
                agentExpr +
                '} with subagent_type "statusline-setup" and the prompt "${' +
                promptExpr +
                "}" +
                guard +
                '"`'
            );
        }
    );
}

function installDurationFormatterLocalization(state) {
    // 本补丁需要直接读写 cli.js 源码（按函数体括号配对定位整个 duration formatter），
    // 无法经由 tryReplace/tryRegexReplace 表达，因此显式注入 state 访问器。
    // state.get() 读当前源码，state.set() 写回，state.bump() 计数。
    const s0 = () => state.get();
    const signature = /function\s+[A-Za-z0-9_$]+\([^)]*\)\{if\([A-Za-z0-9_$]+<60000\)/g;
    let match;

    while ((match = signature.exec(s0())) !== null) {
        const fnStart = match.index;
        const bodyStart = s0().indexOf("{", fnStart);
        if (bodyStart === -1) continue;

        let depth = 0;
        let fnEnd = -1;
        for (let i = bodyStart; i < s0().length; i++) {
            if (s0()[i] === "{") depth++;
            else if (s0()[i] === "}") depth--;
            if (depth === 0) {
                fnEnd = i;
                break;
            }
        }
        if (fnEnd === -1) continue;

        let fn = s0().slice(fnStart, fnEnd + 1);
        if (!fn.includes("mostSignificantOnly") || !fn.includes("toFixed(1)") || !fn.includes("Math.floor")) {
            continue;
        }

        const localized = fn
            .replace(/"0s"/g, '"0秒"')
            .replace(/}d\s+\$\{/g, "}天${")
            .replace(/}h\s+\$\{/g, "}时${")
            .replace(/}m\s+\$\{/g, "}分${")
            .replace(/}d/g, "}天")
            .replace(/}h/g, "}时")
            .replace(/}m/g, "}分")
            .replace(/}s/g, "}秒");

        if (localized !== fn) {
            state.set(s0().slice(0, fnStart) + localized + s0().slice(fnEnd + 1));
            state.bump();
            signature.lastIndex = fnStart + localized.length;
        }
    }
}

function installIssue80VisibleResidueLocalization() {
    // Dynamic UI fragments from Claude Code 2.1.153: keep these structural so
    // broad shards like "Install the " and "Set model to " do not leak into prompts.
    tryRegexReplace(
        /([A-Za-z0-9_$]+(?:\.default)?)\.createElement\(([^,]+),null,"Install the ",\1\.createElement\(\2,\{color:"ide"\},([A-Za-z0-9_$]+)\)," plugin from the JetBrains Marketplace:"," ",\1\.createElement\(\2,\{bold:!0\},"https:\/\/docs\.claude\.com\/s\/claude-code-jetbrains"\)\)/g,
        (match, factory, component, ideName) =>
            `${factory}.createElement(${component},null,"从 JetBrains Marketplace 安装 ",${factory}.createElement(${component},{color:"ide"},${ideName})," 插件："," ",${factory}.createElement(${component},{bold:!0},"https://docs.claude.com/s/claude-code-jetbrains"))`
    );

    tryRegexReplace(
        /let ([A-Za-z0-9_$]+)=`Set model to \$\{([^}]+)\}\$\{([^}]+)\?" and saved as your default for new sessions":" for this session only"\}`/g,
        (match, messageVar, modelExpr, defaultExpr) =>
            `let ${messageVar}=\`已切换模型为 \${${modelExpr}}\${${defaultExpr}?"，并已保存为新会话默认模型":"（仅本次会话）"}\``
    );

    tryRegexReplace(
        /(\blet\s+|,)([A-Za-z0-9_$]+)=`Model set to \$\{([^}]+)\}\$\{([^}]+)\?" and saved as your default for new sessions":" for this session only"\}`/g,
        (match, prefix, messageVar, modelExpr, defaultExpr) =>
            `${prefix}${messageVar}=\`已切换模型为 \${${modelExpr}}\${${defaultExpr}?"，并已保存为新会话默认模型":"（仅本次会话）"}\``
    );

    tryRegexReplace(
        /([A-Za-z0-9_$]+)\(`Set model to \$\{([^}]+)\}`\)/g,
        (match, notifyFn, modelExpr) => `${notifyFn}(\`已切换模型为 \${${modelExpr}}\`)`
    );

    tryRegexReplace(
        /return`Review the current diff for correctness bugs and reuse\/simplification\/efficiency cleanups at the given effort level \(low\/medium: fewer, high-confidence findings; high\\u2192max: broader coverage, may include uncertain findings\$\{([\s\S]*?)\}\)\. Pass --comment to post findings as inline PR comments, or --fix to apply the findings to the working tree after the review\.`/g,
        (match, ultraExpr) => {
            const localizedUltraExpr = ultraExpr
                .replace(/; ultra: deep multi-agent review in the cloud/g, "；ultra：云端深度多 Agent review")
                .replace(/ \(requires claude\.ai account access\)/g, "（需要 claude.ai 账号权限）");
            return `return\`审查当前 diff 的正确性问题，以及复用性、简化和效率改进；按指定 effort 级别执行（low/medium：只报更少、更高置信的问题；high→max：覆盖更广，可能包含不确定问题\${${localizedUltraExpr}}）。传 --comment 可将发现发布为 PR 行内评论，传 --fix 可在 review 后把发现应用到工作区。\``;
        }
    );
}

function installEffortAndWorkflowFooterLocalization() {
    tryRegexReplace(
        /`\$\{([^`]+?)\} to adjust \\xB7 \$\{([^`]+?)\} to confirm \\xB7 \$\{([^`]+?)\} to cancel`/g,
        (match, adjustKeys, confirmKeys, cancelKeys) =>
            `\`\${${adjustKeys}} 调整 · \${${confirmKeys}} 确认 · \${${cancelKeys}} 取消\``
    );

    tryRegexReplace(
        /([A-Za-z0-9_$]+)\.createElement\(([A-Za-z0-9_$]+),null,\1\.createElement\(([A-Za-z0-9_$]+),\{chord:\["left","right"\],action:"adjust"\}\),\1\.createElement\(\3,\{chord:"enter",action:"confirm"\}\),\1\.createElement\(\3,\{chord:"escape",action:"cancel"\}\)\)/g,
        (match, factory, wrapper) =>
            `${factory}.createElement(${wrapper},null,"←/→ 调整 · Enter 确认 · Esc 取消")`
    );

    tryRegexReplace(
        /(?:[A-Za-z0-9_$]+\.)?[A-Za-z0-9_$]+\.createElement\(([A-Za-z0-9_$]+),\{chord:"escape",action:"close"\}\)/g,
        () => '"Esc 关闭"'
    );
}

function installCommonVisibleResidueLocalization() {
    tryRegexReplace(
        /([A-Za-z0-9_$]+(?:\.default)?)\.createElement\(([A-Za-z0-9_$]+),null,\1\.createElement\(([A-Za-z0-9_$]+),\{chord:"enter",action:"confirm"\}\),\1\.createElement\(\3,\{chord:"escape",action:"cancel"\}\)\)/g,
        (match, factory, wrapper) =>
            `${factory}.createElement(${wrapper},null,"Enter 确认","Esc 取消")`
    );

    tryRegexReplace(
        /([A-Za-z0-9_$]+(?:\.default)?)\.createElement\(([A-Za-z0-9_$]+),null,\1\.createElement\(([A-Za-z0-9_$]+),\{chord:"enter",action:"confirm"\}\),\1\.createElement\([A-Za-z0-9_$]+,\{action:"confirm:no",context:"Confirmation",fallback:"Esc",description:"cancel"\}\)\)/g,
        (match, factory, wrapper) =>
            `${factory}.createElement(${wrapper},null,"Enter 确认","Esc 取消")`
    );

    tryRegexReplace(/" for agents"/g, () => '" 查看 Agent"');
    tryRegexReplace(/"for agents"/g, () => '"查看 Agent"');
    tryRegexReplace(/"again "/g, () => '"再次 "');
}

function installWorkflowLifecycleResidueLocalization() {
    tryRegexReplace(
        /`Dynamic workflow requested for this turn\$\{([A-Za-z0-9_$]+)\?` \\xB7 \$\{\1\} to ignore`:""\}`/g,
        (match, keyHint) =>
            "`本轮已请求动态工作流${" + keyHint + "?` · ${" + keyHint + "} 忽略`:\"\"}`"
    );

    tryRegexReplace(
        /`Ultracode keyword ignored for this prompt\$\{([A-Za-z0-9_$]+)\?` \\xB7 \$\{\1\} to undo`:""\}`/g,
        (match, keyHint) =>
            "`已忽略本条提示词中的 Ultracode 关键词${" + keyHint + "?` · ${" + keyHint + "} 撤销`:\"\"}`"
    );
}

function installCli226DisplayDeltaLocalization(state) {
    // The `action` prop on the chord hint is display copy. Keep unrelated raw
    // action/state strings untouched by requiring the complete `b` chord shape.
    tryRegexReplace(
        /(\{chord:"b",action:)"mark bad"(\})/g,
        (match, prefix, suffix) => `${prefix}"标记为不良"${suffix}`
    );

    // Claude Code 2.1.226's q9v startup-warning builder. This is intentionally
    // an exact whole-function anchor: its branch conditions, dynamic model and
    // window expressions, setting/env identifiers, and control flow stay byte
    // for byte identical; only the user-visible literals are localized.
    const unknownModelNoticeSource = 'function q9v(e,t,r){let{source:n,window:o}=Nq(e,t,r);if(n!=="unknown-model")return null;let i=Jmf(e),s=te.CLAUDE_CODE_MAX_CONTEXT_TOKENS;if(i&&s!==void 0&&s>0)return null;let a=[];if(!Jne())a.push("append [1m] to the model name for 1M");if(i)a.push("set CLAUDE_CODE_MAX_CONTEXT_TOKENS to its real window");let l=a.length>0?`If the model accepts more, ${a.join(", or ")}; to make it recognized, `:"To make it recognized, ";return`"${e}" is not a model this version of Claude Code recognizes, so auto-compact will keep this session within ${Ua(o)} tokens (the context window it assumes). ${l}map it in the modelOverrides setting or update Claude Code; CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 restores the previous wait-for-the-API behavior.`}';
    const unknownModelNoticeLocalized = 'function q9v(e,t,r){let{source:n,window:o}=Nq(e,t,r);if(n!=="unknown-model")return null;let i=Jmf(e),s=te.CLAUDE_CODE_MAX_CONTEXT_TOKENS;if(i&&s!==void 0&&s>0)return null;let a=[];if(!Jne())a.push("在模型名称后附加 [1m] 以启用 1M");if(i)a.push("将 CLAUDE_CODE_MAX_CONTEXT_TOKENS 设为该模型的真实窗口");let l=a.length>0?`如果模型支持更大的窗口，请${a.join("，或")}；如需让 Claude Code 识别该模型，请`:"如需让 Claude Code 识别该模型，请";return`"${e}" 不是此版本 Claude Code 可识别的模型，因此自动压缩会将本会话限制在 ${Ua(o)} 个 token 内（这是它假定的上下文窗口）。${l}在 modelOverrides 设置中映射该模型，或更新 Claude Code；设置 CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 可恢复此前等待 API 返回的行为。`}';
    const unknownModelNoticeMatches = state.get().split(unknownModelNoticeSource).length - 1;
    if (unknownModelNoticeMatches === 1) {
        tryReplace(unknownModelNoticeSource, unknownModelNoticeLocalized);
    }
}

function installTurnDurationBackgroundLocalization() {
    // 状态短语 ` · ${summary} still running`：summary 已由翻译表中文化（1 个 shell / N 个 shell），
    // 这里只把模板里紧跟插值后的 still running 中文化。
    // 只匹配 `\xB7 ${...} still running` 这个唯一结构，不碰 MCP/tool 的 `'${o}' still running`。
    tryRegexReplace(
        /(\\xB7 \$\{[^}]+\}) still running/g,
        (_match, prefix) => `${prefix} 仍在运行`
    );
}

function installPastedTextProtocolRepair() {
    // 旧版补丁曾把粘贴附件协议中的 `lines]` 翻译为 `行]`，但解析器只接受英文。
    // 修复 Pasted text 模板生成器，使已 patch 的安装可通过再次安装原地恢复。
    // 匹配两种形态：字面量 `[Pasted text #${id} +${n} 行]` 和变量形式 `[${r} #${e} +${n} 行]`。
    // 变量形式（UJ 函数用 r="Pasted text"）原本未被匹配到，导致修复落空。
    // 字面量形式：`[Pasted text #${id} +${n} 行]`
    tryRegexReplace(
        /(`\[Pasted text #\$\{[A-Za-z0-9_$]+\} \+\$\{[A-Za-z0-9_$]+\} )行(\]`)/g,
        (_match, prefix, suffix) => `${prefix}lines${suffix}`
    );
    // 变量形式：`[${r} #${e} +${n} 行]`
    tryRegexReplace(
        /(`\[\$\{[A-Za-z0-9_$]+\} #\$\{[A-Za-z0-9_$]+\} \+\$\{[A-Za-z0-9_$]+\} )行(\]`)/g,
        (_match, prefix, suffix) => `${prefix}lines${suffix}`
    );
}

function installRunningDisplayLocalization() {
    // 只匹配 JSX children 中的进行中占位文案；工具类型映射里的 Running、
    // 状态枚举 running 以及帮助示例保持原值。
    tryRegexReplace(
        /(children:)"Running\\u2026( ?")/g,
        (_match, prefix, suffix) => `${prefix}"运行中…${suffix}`
    );
    tryRegexReplace(
        /(\?`运行中 \$\{[^}]+\}\(\$\{[^}]+\}\)\\u2026`:)"Running\\u2026"/g,
        (_match, prefix) => `${prefix}"运行中…"`
    );
}

function installVisibleLineCountLocalization() {
    // kAt() 只负责折叠内容的可见“+N lines”摘要。直接输出“行”，
    // 不触碰 Pasted text 占位符中供附件解析器使用的英文协议。
    tryRegexReplace(
        /(function [A-Za-z0-9_$]+\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)="line"\)\{if\(\2<=0\)return"";return`)(\\u2026|…) \+\$\{\2\} \$\{[A-Za-z0-9_$]+\(\2,\3\)\}(`\})/g,
        (_match, prefix, countValue, _unit, ellipsis, suffix) => `${prefix}${ellipsis} +\${${countValue}} 行${suffix}`
    );
}

function installCli233DisplayResidueLocalization() {
    // 2.1.233 的流响应停滞提示拆成 JSX children 数组，时间值为动态插值，
    // 因此不能由静态翻译表覆盖。仅替换完整的三段可见文案结构。
    tryRegexReplace(/"Waiting for API response"/g, () => '"等待 API 响应"');
    tryRegexReplace(
        /children:\[" \\xB7 will retry in ",([A-Za-z0-9_$]+)," \\xB7 check your network"\]/g,
        (_match, remaining) => `children:[" \\xB7 将在 ",${remaining}," 后重试 \\xB7 请检查网络"]`
    );

    // 新版展开提示从快捷键绑定动态生成：`(${shortcut} to expand)`。
    tryRegexReplace(/\$\{([A-Za-z0-9_$]+)\} to expand/g, (_match, shortcut) => `\${${shortcut}} 展开`);

    // yS() 是 /goal 等状态卡片复用的展开辅助组件。使用它的完整函数结构作为锚点，
    // 仅改动该组件提供给 Chord 的可见 action，避免触及其他 action:"expand"。
    tryRegexReplace(
        /(function [A-Za-z0-9_$]+\(\)\{let [A-Za-z0-9_$]+=\w+\.c\(3\),[A-Za-z0-9_$]+=\w+\.useContext\([A-Za-z0-9_$]+\),[A-Za-z0-9_$]+=\w+\.useContext\([A-Za-z0-9_$]+\),[A-Za-z0-9_$]+=ox\("app:toggleTranscript","Global","ctrl\+o"\);if\([A-Za-z0-9_$]+\|\|[A-Za-z0-9_$]+\)\{return null\}[\s\S]*?chord:[A-Za-z0-9_$]+,action:)"expand"/g,
        (_match, prefix) => `${prefix}"展开"`
    );
}

function installGoalActiveIndicatorLocalization() {
    // /goal 状态栏把命令名与状态词拼成一个可见 children 字面量。
    // 只替换位于 children 数组、后接动态时长的显示文本，不改命令名和 active 状态值。
    tryRegexReplace(
        /(children:\[[\s\S]{0,300}?)"\/goal active"(,[A-Za-z0-9_$]+\]\})/g,
        (_match, prefix, suffix) => `${prefix}"/goal 已启用"${suffix}`
    );
}

function installGoalDisplayLocalization() {
    // 2.1.233 的 /goal 状态卡片由条件表达式和动态统计拼接而成，
    // 不会命中静态翻译表；只替换完整的可见字面量，不改状态值或数据字段。
    tryRegexReplace(/"Goal could not be achieved"/g, () => '"未能达成目标"');
    tryRegexReplace(/"Goal achieved"/g, () => '"目标已达成"');
    tryRegexReplace(/"Goal not yet met\\u2026 continuing"/g, () => '"目标尚未达成…继续执行"');
    tryRegexReplace(
        /children:\["Goal: ",([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?)\]/g,
        (_match, condition) => `children:["目标：",${condition}]`
    );
    tryRegexReplace(
        /(case"goal_status"[\s\S]*?\.tokens!==void 0\)\{[A-Za-z0-9_$]+\.push\(`\$\{[A-Za-z0-9_$]+\} tokens`\)\})/g,
        (_match, goalStatusBlock) => goalStatusBlock.replace(/ tokens`\)\}/, " 个 token`)}")
    );
}

function installGoalCommandMessageLocalization() {
    // /goal 命令的 system/status 消息模板。fixture 取自 2.1.237 exe 原文。
    // 模板字面量内是 minify 标识符，按结构通配；case key、阈值常量与 goal 条件文本不动。
    tryRegexReplace(
        /`Goal set: \$\{([A-Za-z0-9_$]+)\}`/g,
        (_m, v) => '`目标已设置：${' + v + '}`'
    );
    tryRegexReplace(
        /`Goal cleared: \$\{([A-Za-z0-9_$]+)\}`/g,
        (_m, v) => '`目标已清除：${' + v + '}`'
    );
    tryReplace('"No goal set"', '"尚未设置目标"');
    tryRegexReplace(
        /`Goal active: \$\{([A-Za-z0-9_$]+\.condition)\} \(\$\{([A-Za-z0-9_$]+)\}\)\$\{([A-Za-z0-9_$]+)\}`/g,
        (_m, cond, iter, tail) => '`目标执行中：${' + cond + '}（${' + iter + '}）${' + tail + '}`'
    );
    tryRegexReplace(
        /`Goal condition is limited to \$\{([A-Za-z0-9_$]+)\} characters \(got \$\{([A-Za-z0-9_$]+\.length)\}\)`/g,
        (_m, limit, got) => '`目标条件的字符数限制为 ${' + limit + '} 个字符（当前 ${' + got + '} 个）`'
    );
    tryRegexReplace(
        /`Goal cleared after an unrecoverable error \(\$\{([A-Za-z0-9_$]+)\}\): "(\$\{[^`]*\})"\. Run \/goal again to continue\.`/g,
        (_m, err, cond) => '`目标已清除（由于不可恢复的错误 ${' + err + '}）："' + cond + '"。请重新运行 /goal 继续。`'
    );
}

function installBackgroundCommandNotificationLocalization() {
    // 后台命令 task-notification：jkt("Background command ") 前缀由翻译表处理，
    // 这里把 4 个状态后缀模板转中文；任务名变量保留原样。
    tryRegexReplace(
        /"\$\{([A-Za-z0-9_$]+)\}" completed\$\{([A-Za-z0-9_$]+)!==void 0\?` \(exit code \$\{([A-Za-z0-9_$]+)\}\)`:""\}/g,
        (_m, t, n1, n2) => '"${' + t + '}" 已完成${' + n1 + '!==void 0?`（退出码 ${' + n2 + '}）`:""}'
    );
    tryRegexReplace(
        /"\$\{([A-Za-z0-9_$]+)\}" failed\$\{([A-Za-z0-9_$]+)!==void 0\?` with exit code \$\{([A-Za-z0-9_$]+)\}`:""\}/g,
        (_m, t, n1, n2) => '"${' + t + '}" 失败${' + n1 + '!==void 0?`（退出码 ${' + n2 + '}）`:""}'
    );
    tryRegexReplace(
        /"\$\{([A-Za-z0-9_$]+)\}" was stopped`/g,
        (_m, t) => '"${' + t + '}" 已停止`'
    );
    tryRegexReplace(
        /"\$\{([A-Za-z0-9_$]+)\}" appears to be waiting for interactive input`/g,
        (_m, t) => '"${' + t + '}" 似乎在等待交互输入`'
    );
}

function installContextGroupingLocalization() {
    // /context 面板的来源分组标签。两个 label switch 的 case key 是内部状态枚举，
    // 只替换 return 的显示字面量；MLE 排序数组必须与 G1o 返回值同步翻译，
    // 保持 indexOf(label) 排序逻辑不破。
    tryRegexReplace(
        /case"userSettings":return"User";case"projectSettings":return"Project";case"localSettings":return"Local";case"flagSettings":return"Flag";case"policySettings":return"Managed";case"plugin":return"Plugin";case"built-in":return"Built-in";case"mcp":return"MCP";case"memoryStore":return"Memory store";case"syncedSkills":return ([A-Za-z0-9_$]+)/g,
        (_m, rpe) => 'case"userSettings":return"用户";case"projectSettings":return"项目";case"localSettings":return"本地";case"flagSettings":return"标志";case"policySettings":return"托管";case"plugin":return"插件";case"built-in":return"内置";case"mcp":return"MCP";case"memoryStore":return"记忆存储";case"syncedSkills":return ' + rpe
    );
    tryRegexReplace(
        /case"flagged":return"Flagged";case"project":return"Project";case"local":return"Local";case"user":return"User";case"enterprise":return"Enterprise";case"managed":return"Managed";case"builtin":case"dynamic":return"Built-in";case"skills":return"Skills"/g,
        () => 'case"flagged":return"已标记";case"project":return"项目";case"local":return"本地";case"user":return"用户";case"enterprise":return"企业";case"managed":return"托管";case"builtin":case"dynamic":return"内置";case"skills":return"技能"'
    );
    tryRegexReplace(/var [A-Za-z0-9_$]+="claude\.ai sync"/g, (m) => m.replace('"claude.ai sync"', '"claude.ai 同步"'));
    tryRegexReplace(
        /\["Project","User",([A-Za-z0-9_$]+),"Managed","Plugin","MCP","Built-in"\]/g,
        (_m, rpe) => '["项目","用户",' + rpe + ',"托管","插件","MCP","内置"]'
    );
    tryRegexReplace(/{dimColor:!0,children:"Available"}/g, () => '{dimColor:!0,children:"可用"}');
    tryRegexReplace(/{dimColor:!0,children:"Loaded"}/g, () => '{dimColor:!0,children:"已加载"}');
}

function installPressEnterContinuationLocalization() {
    // 权限/平台设置提示把 "Press Enter to continue/retry" 拆成 ["Press ",<jsx>.jsx(b,{bold:!0,children:"Enter"})," to ..."]
    // 三个字面量，翻译表子串匹配命中不了。按 children 结构通配 minify 标识符，
    // 只换显示文案，Enter 键名、bold 结构、jsx 调用形态原样保留。
    tryRegexReplace(
        /(children:\[)"Press ",([A-Za-z0-9_$]+\.jsx\([A-Za-z0-9_$]+,\{bold:!0,children:"Enter"\}\),)" to continue\."\]/g,
        (_m, pre, jsx) => `${pre}"按 ",${jsx}" 继续。"]`
    );
    tryRegexReplace(
        /(children:\[)"Couldn't start your trial\. Press ",([A-Za-z0-9_$]+\.jsx\([A-Za-z0-9_$]+,\{bold:!0,children:"Enter"\}\),)" to continue\."\]/g,
        (_m, pre, jsx) => `${pre}"无法开始试用。按 ",${jsx}" 继续。"]`
    );
    tryRegexReplace(
        /(children:\[)"Press ",([A-Za-z0-9_$]+\.jsx\([A-Za-z0-9_$]+,\{bold:!0,children:"Enter"\}\),)" to retry\."\]/g,
        (_m, pre, jsx) => `${pre}"按 ",${jsx}" 重试。"]`
    );
    tryRegexReplace(
        /\["Press ",([A-Za-z0-9_$]+\.[A-Za-z0-9_$]+)," again to exit"\]/g,
        (_m, key) => `["再按 ",${key}," 退出"]`
    );
}

function installStatusbarToolActivityLocalization() {
    // Thought 状态栏（进行中 Thinking / 完成 Thought）
    tryRegexReplace(/([A-Za-z0-9_$]+)\?"Thinking":"Thought"/g, (_m, v) => `${v}?"思考中":"思考"`);
    // Thought/思考时长拼接（children:[Oe," for ",ge]},"thought"）
    tryRegexReplace(
        /children:\[([A-Za-z0-9_$]+)," for ",([A-Za-z0-9_$]+)\]},"thought"/g,
        (_m, label, dur) => `children:[${label},"（",${dur},"）"]},"thought"`
    );

    // mem-search 状态栏（ye() 第三参数是固定复数 "memories"，需整体替换，先于动词对执行）
    tryRegexReplace(
        /ye\("mem-search",([A-Za-z0-9_$]+)\?"searching":"searched","memories"\)/g,
        (_m, v) => `ye("mem-search",${v}?"正在搜索":"已搜索","条记忆")`
    );

    // ye() 状态栏动词对（先长后短，短词不会命中长词的子串）
    const yeVerbs = [
        ["searching for", "searched for", "正在搜索", "已搜索"],
        ["editing", "edited", "正在编辑", "已编辑"],
        ["publishing", "published", "正在发布", "已发布"],
        ["recalling", "recalled", "正在回忆", "已回忆"],
        ["searching", "searched", "正在搜索", "已搜索"],
        ["listing", "listed", "正在列出", "已列出"],
        ["running", "ran", "正在运行", "已运行"],
        ["calling", "called", "正在调用", "已调用"],
        ["writing", "wrote", "正在写入", "已写入"],
        ["making", "made", "正在创建", "已创建"],
        ["reading", "read", "正在读取", "已读取"],
    ];
    for (const [present, past, zhPresent, zhPast] of yeVerbs) {
        tryRegexReplace(
            new RegExp(`([A-Za-z0-9_$]+)\\?"${present}":"${past}"`, "g"),
            (_m, v) => `${v}?"${zhPresent}":"${zhPast}"`
        );
    }
    tryRegexReplace(/([A-Za-z0-9_$]+)\?"REPL'ing":"REPL'd"/g, (_m, v) => `${v}?"正在REPL":"已REPL"`);

    // tool activity 摘要动词（xWo / team / 展开版共用 VAR===0 结构）
    const activityVerbs = [
        ["Searching for", "searching for", "Searched for", "searched for", "正在搜索", "已搜索"],
        ["Recalling", "recalling", "Recalled", "recalled", "正在回忆", "已回忆"],
        ["Searching", "searching", "Searched", "searched", "正在搜索", "已搜索"],
        ["Writing", "writing", "Wrote", "wrote", "正在写入", "已写入"],
        ["Reading", "reading", "Read", "read", "正在读取", "已读取"],
        ["Listing", "listing", "Listed", "listed", "正在列出", "已列出"],
    ];
    for (const [present, lower, past, pastLower, zhPresent, zhPast] of activityVerbs) {
        tryRegexReplace(
            new RegExp(
                `([A-Za-z0-9_$]+)===0\\?"${present}":"${lower}":\\1===0\\?"${past}":"${pastLower}"`,
                "g"
            ),
            (_m, v) => `${v}===0?"${zhPresent}":"${zhPresent}":${v}===0?"${zhPast}":"${zhPast}"`
        );
    }
    // 224+ tool activity / teamMemory 摘要动词：条件从 VAR===0 改为 VAR?X.length===0?，
    // 三元链泛化匹配（VAR?COND?"Present":"lower":COND?"Past":"pastLower"），避免小写动词残留
    const activityVerbs224 = [
        ["Searching for", "searching for", "Searched for", "searched for", "正在搜索", "已搜索"],
        ["Searching", "searching", "Searched", "searched", "正在搜索", "已搜索"],
        ["Recalling", "recalling", "Recalled", "recalled", "正在回忆", "已回忆"],
        ["Writing", "writing", "Wrote", "wrote", "正在写入", "已写入"],
        ["Reading", "reading", "Read", "read", "正在读取", "已读取"],
        ["Listing", "listing", "Listed", "listed", "正在列出", "已列出"],
    ];
    for (const [present, lower, past, pastLower, zhPresent, zhPast] of activityVerbs224) {
        tryRegexReplace(
            new RegExp(
                `([A-Za-z0-9_$]+)\\?([^"]*?)\\?"${present}":"${lower}":\\2\\?"${past}":"${pastLower}"`,
                "g"
            ),
            (_m, v, cond) => `${v}?${cond}?"${zhPresent}":"${zhPresent}":${cond}?"${zhPast}":"${zhPast}"`
        );
    }
    // 相关记忆列表（read→正在回忆/已回忆，write→正在记住/已记住）
    tryRegexReplace(
        /([A-Za-z0-9_$]+)\?"Recalling":"Recalled":\1\?"Remembering":"Remembered"/g,
        (_m, v) => `${v}?"正在回忆":"已回忆":${v}?"正在记住":"已记住"`
    );

    // 状态栏数量名词（children: X})}," ",X===1?"单数":"复数"）
    const statusNouns = [
        ["file", "files", "个文件"],
        ["pattern", "patterns", "个匹配"],
        ["memory", "memories", "条记忆"],
        ["tool", "tools", "个工具"],
        ["agent", "agents", "个 Agent"],
        ["time", "times", "次"],
        ["directory", "directories", "个目录"],
    ];
    for (const [singular, plural, zh] of statusNouns) {
        tryRegexReplace(
            new RegExp(`children:([A-Za-z0-9_$]+)\\)\\}," ",\\1===1\\?"${singular}":"${plural}"`, "g"),
            (_m, v) => `children:${v})}," ",${v}===1?"${zh}":"${zh}"`
        );
    }
    // 通用数量名词（覆盖 children 数组结构、模板、属性访问等，如 uncommitted/occurrences 残留）
    const pluralNouns = [
        ["file", "files", "个文件"],
        ["pattern", "patterns", "个匹配"],
        ["memory", "memories", "条记忆"],
        ["tool", "tools", "个工具"],
        ["agent", "agents", "个 Agent"],
        ["time", "times", "次"],
        ["directory", "directories", "个目录"],
    ];
    for (const [singular, plural, zh] of pluralNouns) {
        tryRegexReplace(
            new RegExp(`([A-Za-z0-9_$]+(?:\\.[A-Za-z0-9_$]+)?)===1\\?"${singular}":"${plural}"`, "g"),
            (_m, v) => `${v}===1?"${zh}":"${zh}"`
        );
    }
    // scratchpad / bash / team 记忆（" X"," " 分隔的特殊结构）
    tryRegexReplace(/" scratchpad"," ",([A-Za-z0-9_$]+)===1\?"edit":"edits"/g, () => '" 个 scratchpad 修改"');
    tryRegexReplace(/" shell"," ",([A-Za-z0-9_$]+)===1\?"command":"commands"/g, () => '" 个 shell 命令"');
    tryRegexReplace(/" team"," ",([A-Za-z0-9_$]+)===1\?"memory":"memories"/g, () => '" 条团队记忆"');

    // tool activity 摘要内的数量名词（`${verb} ${count} ${count===1?"file":"files"}`）
    const activityNouns = [
        ["file", "files", "个文件"],
        ["pattern", "patterns", "个匹配"],
        ["memory", "memories", "条记忆"],
        ["time", "times", "次"],
        ["directory", "directories", "个目录"],
    ];
    for (const [singular, plural, zh] of activityNouns) {
        tryRegexReplace(
            new RegExp(
                `\\$\\{([A-Za-z0-9_$]+)\\}\\s+\\$\\{([A-Za-z0-9_$]+)===1\\?"${singular}":"${plural}"\\}`,
                "g"
            ),
            (_m, count) => `\${${count}} ${zh}`
        );
    }
    // team 记忆（mem-search 固定复数，模板 `${X} team memories`）
    tryRegexReplace(/\$\{([A-Za-z0-9_$]+)\} team memories\`/g, (_m, verb) => `\${${verb}} 条团队记忆\``);
    // team 记忆（mem-read 有数量，`team ${X===1?"memory":"memories"}`）
    tryRegexReplace(/team \$\{([A-Za-z0-9_$]+)===1\?"memory":"memories"\}/g, () => "条团队记忆");
    // team memory 固定复数（224+ 无 team 前缀的 `${X} memories` 模板）
    tryRegexReplace(/\$\{([A-Za-z0-9_$]+)\} memories\`/g, (_m, verb) => `\${${verb}} 条记忆\``);
    // team 记忆（224+ 数量分支：memory/memories 可能已被数量名词规则先翻译成"条记忆"，覆盖两态）
    tryRegexReplace(
        /team \$\{([A-Za-z0-9_$]+)===1\?(?:"memory":"memories"|"条记忆":"条记忆")\}/g,
        () => "条团队记忆"
    );

    // git / PR 动词对象
    tryReplace(
        'let Oe={committed:"committed",amended:"amended commit","cherry-picked":"cherry-picked"}',
        'let Oe={committed:"已提交",amended:"已修订提交","cherry-picked":"已拣选提交"}'
    );
    tryReplace('ye("push","pushed to",', 'ye("push","推送到",');
    tryReplace('let Oe={merged:"merged",rebased:"rebased onto"}', 'let Oe={merged:"已合并",rebased:"已变基到"}');
    tryReplace(
        'let Oe={created:"created",edited:"edited",merged:"merged",commented:"commented on",closed:"closed",ready:"marked ready",draft:"marked draft","auto-merge-enabled":"enabled auto-merge on","auto-merge-disabled":"disabled auto-merge on"}',
        'let Oe={created:"已创建",edited:"已编辑",merged:"已合并",commented:"评论了",closed:"已关闭",ready:"已标记就绪",draft:"已标记草稿","auto-merge-enabled":"已开启自动合并","auto-merge-disabled":"已关闭自动合并"}'
    );

    // Hook 状态行（两种结构）
    tryRegexReplace(
        /"Ran ",([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)+)," ","PreToolUse ",\1===1\?"hook":"hooks"/g,
        (_m, c) => `"已运行 ",${c}," 个 PreToolUse Hook"`
    );
    tryRegexReplace(
        /"Ran ",([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)+)," PreToolUse"," ",\1===1\?"hook":"hooks"/g,
        (_m, c) => `"已运行 ",${c}," 个 PreToolUse Hook"`
    );
    // 224+ 无 Ran 前缀的 hook 状态行（active 分支 Oe("hooks","ran",...) 推送结构）
    tryRegexReplace(
        /children:([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?)\}\)," PreToolUse"," ",\1===1\?"hook":"hooks"/g,
        (_m, c) => `children:${c}})," 个 PreToolUse Hook"`
    );

    // 224+ memoized Hook 状态行（React JSX transform 生成缓存分支，字面量与直接 JSX 分离）
    // hook/hooks 数量名词（覆盖无 Ran 前缀的直接 JSX 与 memo 分支定义）
    tryRegexReplace(
        /([A-Za-z0-9_$]+)===1\?"hook":"hooks"/g,
        (_m, count) => `${count}===1?"个 Hook":"个 Hook"`
    );
    // memo 分支 "Ran " 字面量（children:[...,"Ran ",count," ",hookLabel," ",noun,""]）
    // 词序纠正：输出 "已运行 <count> 个 <hookLabel> Hook"（防止出现 "已运行 1 stop 个 Hook" 的错误顺序）
    tryRegexReplace(
        /"Ran ",([A-Za-z0-9_$]+)," ",([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)?)," ",([A-Za-z0-9_$]+),""/g,
        (_m, count, label) => `"已运行 ",${count}," 个 ",${label}," Hook",""`
    );
}

function installConfigRemainderLocalization() {
    // /config 配置项 label（结构 patch，避免翻译表混杂句子）
    const configLabels = [
        ["Theme", "主题"],
        ["Local notifications", "本地通知"],
        ["Output style", "输出风格"],
        ["Language", "语言"],
        ["Model", "模型"],
        ["Artifacts", "工件"],
        ["Ultracode keyword trigger", "Ultracode 关键词触发"],
        ["Worktree base ref", "Worktree 基准引用"],
        ["Skip the /copy picker", "跳过 /copy 选择器"],
        ["Open agents view by default", "默认打开 Agent 视图"],
        ["Question auto-continue timeout", "问题自动继续超时"],
        ["Precompute compaction", "预计算压缩"],
        ["Show message timestamps", "显示消息时间戳"],
        ["Push when actions required", "需要操作时推送"],
        ["Push when Claude decides", "Claude 决定时推送"],
    ];
    for (const [en, zh] of configLabels) {
        tryReplace(`label:"${en}"`, `label:"${zh}"`);
    }
    // Teammate mode：label 是三元分支里的字面量，不用 `label:` 前缀
    tryReplace(':"Teammate mode"', ':"协作模式"');
    tryRegexReplace(/`Teammate mode \[overridden: \$\{([^}]+)\}\]`/g, (_m, expr) => `\`协作模式 [已被覆盖：\${${expr}}]\``);
    tryReplace('pTr("Auto-scroll",', 'pTr("自动滚动",');
    tryReplace('pTr("Show last response in external editor",', 'pTr("在外部编辑器中显示最后回复",');
    tryReplace('"For custom themes, use /theme."', '"自定义主题请使用 /theme。"');
    tryReplace('"For custom styles, open /config."', '"自定义样式请打开 /config。"');
    tryReplace('"For a specific model ID, use /model."', '"指定模型 ID 请使用 /model。"');
    tryReplace('"For a specific model ID, open /config."', '"指定模型 ID 请打开 /config。"');
    tryReplace(
        `"Any language name or ISO code (e.g. 'ja'); use 'default' for English."`,
        `"任意语言名称或 ISO 代码（如 'ja'）；'default' 表示英语。"`
    );
    tryRegexReplace(/\(disabled in safe mode\)/g, () => "（安全模式下禁用）");
}

function installErrorTemplateLocalization() {
    // CommandExec 状态描述模板（$sg 内 return 语句，均以反引号闭合，不会误伤日志文本）
    tryRegexReplace(/\`failed with exit code \$\{([^}]+)\}\`/g, (_m, v) => `\`失败，退出码 \${${v}}\``);
    tryRegexReplace(/\`failed with \$\{([^}]+)\}\`/g, (_m, v) => `\`失败：\${${v}}\``);
    tryRegexReplace(
        /\`was killed with \$\{([^}]+)\} \(\$\{([^}]+)\}\)\`/g,
        (_m, sig, desc) => `\`被终止（\${${sig}}：\${${desc}}）\``
    );
    tryRegexReplace(/\`timed out after \$\{([^}]+)\} milliseconds\`/g, (_m, t) => `\`超时（\${${t}} 毫秒）\``);
}

function installCli233ResidualUILocalization() {
    // 2.1.233 六个用户报告残留 + 主动扫描到的同族动态 UI 文案。
    // 全部是给用户看的显示文案；API/环境变量名（stop_hook_active、
    // CLAUDE_CODE_STOP_HOOK_BLOCK_CAP、--model）和状态枚举（idle/attached）保持英文。

    // 1. Null-bytes 错误只改 UI 可显示的 Error 文案，不触碰 makeErrorWithCode 内部 API
    tryRegexReplace(
        /throw Error\("Path contains null bytes"\)/g,
        () => 'throw Error("路径包含空字节")'
    );

    // 2. 中断回合的追问后缀（已中断 已汉化，这里补问句）
    tryRegexReplace(
        /children:"\\xB7 What should Claude do instead\?"/g,
        () => 'children:"\\xB7 Claude 应该怎么做？"'
    );

    // 3. 模型选择器 fallback 文案（保留 --model 选项描述）
    tryReplace(
        '"Switch between Claude models. Your pick becomes the default for new sessions. For other/previous model names, specify with --model."',
        '"切换 Claude 模型。你的选择会作为新会话的默认模型。其他/之前的模型名称请用 --model 指定。"'
    );

    // 4. Stop/SubagentStop Hook 阻断警告（分号转义模板与字符串拼接两段）
    tryRegexReplace(
        /`A hook blocked the turn from ending \$\{([^}]+)\} consecutive times \\u2014 overriding and ending turn\. `\+"For Stop\/SubagentStop hooks, check stop_hook_active in the input and return success while it's true\. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit\."/g,
        (_m, oa) =>
            "`一个 Hook 已连续 ${" + oa + "} 次阻止回合结束 \\u2014 正在覆盖并结束回合。 `+" +
            '"对于 Stop/SubagentStop Hook，请检查输入中的 stop_hook_active，并在其值为 true 时返回成功。设置 CLAUDE_CODE_STOP_HOOK_BLOCK_CAP 可提高此上限。"'
    );

    // 5. 状态栏上下文占用/压缩提示（保留动态百分比和 /compact 命令名）
    tryRegexReplace(
        /\$\{100-([^}]+)\}% context used/g,
        (_m, v) => `\${100-${v}}% 上下文已使用`
    );
    tryRegexReplace(
        /\$\{([^}]+)\}% until auto-compact/g,
        (_m, v) => `\${${v}}% 后自动压缩`
    );
    tryRegexReplace(
        /Context low \(\$\{([^}]+)\}% remaining\)/g,
        (_m, v) => `上下文不足（剩余 \${${v}}%）`
    );
    // 注意：此替换须避免命中 NCw 拼接的 `${NCw} \xB7 ${psc}`（第5前序部分），
    // 这里只改独立存在的 `\xB7 Run /compact ...` 模板尾段。
    tryRegexReplace(
        /\\xB7 Run \/compact to compact & continue/g,
        () => " \\xB7 运行 /compact 压缩并继续"
    );

    // 6. thinking 状态动词集（函数名与阈值常量名随上游 minify 漂移，按结构匹配；
    //    只替换返回的英文字符串，保留函数名、参数与阈值比较逻辑，不改变内部判断）
    tryRegexReplace(
        /function ([A-Za-z_$][\w$]*)\(([^)]+)\)\{if\(\2>=([A-Za-z_$][\w$]*)\)return"almost done thinking";if\(\2>=([A-Za-z_$][\w$]*)\)return"thinking some more";if\(\2>=([A-Za-z_$][\w$]*)\)return"thinking more";if\(\2>=([A-Za-z_$][\w$]*)\)return"still thinking";return"thinking"\}/g,
        (_m, fn, e, f, ys, ny, ly) =>
            `function ${fn}(${e}){if(${e}>=${f})return"即将完成思考";if(${e}>=${ys})return"继续思考中";if(${e}>=${ny})return"深入思考";if(${e}>=${ly})return"仍在思考";return"思考中"}`
    );

    // 7. effort 后缀模板（保留 effort level API 值；gge/D2e 只做取值）
    tryRegexReplace(
        /` with \$\{([^}]+)\} effort`/g,
        (_m, expr) => "`（思考强度 ${" + expr + "}）`"
    );

    // 8. 工具/思考活动时长模板（la 时长已汉化,只改前缀与后缀）
    tryRegexReplace(
        /`running tool for \$\{la\(([^}]+)\)\}`/g,
        (_m, ms) => "`正在运行工具，已用 ${la(" + ms + ")}`"
    );
    tryRegexReplace(
        /`ran tool for \$\{la\(([^}]+)\)\}`/g,
        (_m, ms) => "`已完成工具，用时 ${la(" + ms + ")}`"
    );
    tryRegexReplace(
        /`thought for \$\{Math\.max\(1,Math\.round\(([^}]+)\/1000\)\)\}s`/g,
        (_m, ms) => "`已思考 ${Math.max(1,Math.round(" + ms + "/1000))} 秒`"
    );

    // 9. remoting banner 连接/重连提示（ReactNode + 模板拼接）
    tryRegexReplace(/Xt\.yellow\("Connecting"\)/g, () => 'Xt.yellow("连接中")');
    tryRegexReplace(/Xt\.yellow\("Reconnecting"\)/g, () => 'Xt.yellow("重新连接")');
    tryRegexReplace(/`retrying in \$\{([^}]+)\}`/g, (_m, v) => `\`\${${v}} 后重试\``);
    tryRegexReplace(/`disconnected \$\{([^}]+)\}`/g, (_m, v) => `\`已断开 \${${v}}\``);

    // 10. remoting 状态赋值的可见文案（只改字符串值,状态键 idle/attached 不变）
    // 匹配 updateIdleStatus/setAttached 内紧凑赋值,保留逗号与变量 i
    tryRegexReplace(/,i="Ready",/g, () => ',i="就绪",');
    tryRegexReplace(/,i="Connected",/g, () => ',i="已连接",');

    // 11. FleetView 任务状态显示映射（键是状态枚举,值是给用户的显示文案）
    tryReplace(
        ',E4t={review:"Ready for review",blocked:"Needs input",working:"Working",done:"Completed"}',
        ',E4t={review:"待审核",blocked:"需要输入",working:"进行中",done:"已完成"}'
    );
    tryReplace(
        ',mKw={review:"",blocked:"Sessions that have a question or need your decision land here",working:"Sessions Claude is actively working on \\u2014 they keep running even if you close the terminal",done:"Finished sessions wait here for you to review"}',
        ',mKw={review:"",blocked:"需要你决策的会话会出现在这里",working:"Claude 正在积极处理的会话 \\u2014 关闭终端后仍在运行",done:"已完成的会话留在这里等待你查看"}'
    );

    // 12. resume 提示（resumeHint 写入 stdout 的模板；保留 claude --resume/--worktree 命令形态）
    // cli.js 中该模板的换行可能是真实换行 U+000A（JSON.stringify 显示为 \n）或字面 `\n`
    // （反斜杠+n 两字符），两种形态都匹配。
    tryRegexReplace(
        /`(\n|\\n)Resume this session with:(\n|\\n)claude \$\{([^}]+)\}--resume \$\{([^}]+)\}(\n|\\n)`/g,
        (_m, _a, _b, o, r, _c) => `\`\\n请使用以下命令继续会话：\\nclaude \${${o}}--resume \${${r}}\\n\``
    );

    // 13. /rewind 回滚提示的多段 push 数组（保留 --- 分隔线、/rewind 命令名与 ${e.ref} 变量）
    tryReplace(
        '"Don\'t want these changes? Resume this session (above), then run"',
        '"不想保留这些更改？请在上方恢复会话，然后运行"'
    );
    tryReplace(
        '"`/rewind` to roll back the turn\'s tool edits (bash-made changes"',
        '"`/rewind` 回滚本次回合的工具编辑（bash 产生的更改"'
    );
    tryReplace(
        "`excluded). ${e.ref} holds a full snapshot until this session's`",
        "`（已排除）。${e.ref} 存储了完整快照，直到本次会话的`"
    );
    tryReplace(
        '"next checkpoint, or for up to ~2 weeks."',
        '"下一个检查点，或最长约 2 周。"'
    );

    // 14. remote-control 恢复/环境保留提示（保留 claude remote-control、--continue、--session-id 命令形态）
    tryRegexReplace(
        /`Resume this session by running \\`claude remote-control \$\{e\.ownsPointer\?"--continue":`--session-id \$\{l\}`\}\\\``/g,
        () => '`请运行 \\`claude remote-control ${e.ownsPointer?"--continue":`--session-id ${l}`}\\` 恢复本会话`'
    );
    tryReplace(
        '"Environment preserved. Restart `claude remote-control` to reconnect existing sessions."',
        '"环境已保留。请重新启动 `claude remote-control` 以重新连接现有会话。"'
    );

    // 15. auto_mode_pregather 上下文标签（显示在 context 标签中）
    tryReplace(
        '"CLAUDE.md files and project docs"',
        '"CLAUDE.md 文件与项目文档"'
    );
    tryReplace(
        '"Repo facts"',
        '"仓库事实"'
    );
    tryReplace(
        '"Existing auto-mode settings (selective read)"',
        '"现有自动模式设置（选择性读取）"'
    );
    tryReplace(
        '"Recent usage in this project (names only)"',
        '"此项目的最近使用情况（仅名称）"'
    );
    tryReplace(
        '"Config scans (names only)"',
        '"配置扫描（仅名称）"'
    );
    tryReplace(
        '"Shipped default auto-mode rule labels"',
        '"随附的默认自动模式规则标签"'
    );

    // 16. hook 配置 schema 描述（/hooks 配置帮助文本）
    tryReplace(
        '"Custom status message to display in spinner while hook runs"',
        '"Hook 运行时在 spinner 显示的自定义状态消息"'
    );
    tryReplace(
        '"If true, hook runs once and is removed after execution"',
        '"若为 true，Hook 只运行一次，执行后即移除"'
    );

    // 17. 新功能公告标题与遥测确认文案
    tryReplace(
        '"Feature of the week:"',
        '"本周功能："'
    );
    tryReplace(
        '"Help improve our AI models "',
        '"帮助改进我们的 AI 模型 "'
    );

    // 18. memory 保存说明标题属于模型提示词契约（cli-translations.json 已标记
    //     skipPatch:"model-prompt-contract"），不得在此硬编码翻译，否则会绕过标记
    //     并触发 upstream-compat 的 system_prompt_memory_contract preserve 失败。

    // 19. 遥测开关相关（无尾空格标题、隐私选项 label、日志；\xB7 为源码字面转义）
    tryReplace(
        '"Help improve our AI models"',
        '"帮助改进我们的 AI 模型"'
    );
    tryReplace(
        '"Accept terms \\xB7 Help improve our AI models: ON"',
        '"接受条款 \\xB7 帮助改进我们的 AI 模型：开"'
    );
    tryReplace(
        '"Accept terms \\xB7 Help improve our AI models: OFF"',
        '"接受条款 \\xB7 帮助改进我们的 AI 模型：关"'
    );
    tryReplace(
        '"Accept terms \\xB7 Help improve our AI models: OFF (for emails with your domain)"',
        '"接受条款 \\xB7 帮助改进我们的 AI 模型：关（针对你域名的邮件）"'
    );
}
    return [
        { name: "installStatuslinePromptPathGuard", run: (st) => installStatuslinePromptPathGuard(st) },
        { name: "installStatuslineCommandPromptPathGuard", run: (st) => installStatuslineCommandPromptPathGuard(st) },
        { name: "installDurationFormatterLocalization", run: (st) => installDurationFormatterLocalization(st) },
        { name: "installIssue80VisibleResidueLocalization", run: (st) => installIssue80VisibleResidueLocalization(st) },
        { name: "installEffortAndWorkflowFooterLocalization", run: (st) => installEffortAndWorkflowFooterLocalization(st) },
        { name: "installCommonVisibleResidueLocalization", run: (st) => installCommonVisibleResidueLocalization(st) },
        { name: "installWorkflowLifecycleResidueLocalization", run: (st) => installWorkflowLifecycleResidueLocalization(st) },
        { name: "installCli226DisplayDeltaLocalization", run: (st) => installCli226DisplayDeltaLocalization(st) },
        { name: "installTurnDurationBackgroundLocalization", run: (st) => installTurnDurationBackgroundLocalization(st) },
        { name: "installPastedTextProtocolRepair", run: (st) => installPastedTextProtocolRepair(st) },
        { name: "installRunningDisplayLocalization", run: (st) => installRunningDisplayLocalization(st) },
        { name: "installVisibleLineCountLocalization", run: (st) => installVisibleLineCountLocalization(st) },
        { name: "installCli233DisplayResidueLocalization", run: (st) => installCli233DisplayResidueLocalization(st) },
        { name: "installGoalActiveIndicatorLocalization", run: (st) => installGoalActiveIndicatorLocalization(st) },
        { name: "installGoalDisplayLocalization", run: (st) => installGoalDisplayLocalization(st) },
        { name: "installGoalCommandMessageLocalization", run: (st) => installGoalCommandMessageLocalization(st) },
        { name: "installBackgroundCommandNotificationLocalization", run: (st) => installBackgroundCommandNotificationLocalization(st) },
        { name: "installContextGroupingLocalization", run: (st) => installContextGroupingLocalization(st) },
        { name: "installPressEnterContinuationLocalization", run: (st) => installPressEnterContinuationLocalization(st) },
        { name: "installStatusbarToolActivityLocalization", run: (st) => installStatusbarToolActivityLocalization(st) },
        { name: "installConfigRemainderLocalization", run: (st) => installConfigRemainderLocalization(st) },
        { name: "installErrorTemplateLocalization", run: (st) => installErrorTemplateLocalization(st) },
        { name: "installCli233ResidualUILocalization", run: (st) => installCli233ResidualUILocalization(st) },
    ];
}

// 需要直接读写源码状态的补丁（其余补丁只用 tryReplace/tryRegexReplace）
const STATE_DEPENDENT_STEPS = ["installDurationFormatterLocalization"];

module.exports = { createLocalizationSteps, STATE_DEPENDENT_STEPS };
