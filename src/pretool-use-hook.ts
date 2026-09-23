/**
 * PreToolUse 执法脚本 — command-gate hook 固化版（studio#153）
 *
 * 内容 = studio-agent provider-hooks.buildHookScriptContent 生成脚本（#147）的固化版，
 * 归属归位：谁的东西谁发货——CommandGate 是 harness 的，hook 脚本随 harness 包出厂。
 * 编译产物 = 包内 dist/pretool-use-hook.js，provider hook 配置（codex hooks.json /
 * kimi config.toml）直接指向 require.resolve('@dommaker/harness') 同目录的该文件，
 * 不再由 studio-agent 按 worktree 生成、不再内嵌绝对路径。
 *
 * 语义（与生成版一致）：
 * - stdin 收 provider PreToolUse JSON（tool_input.command）；
 * - CommandGate 判定 block 级黑名单，命中 → stderr 写原因 + exit 2
 *   （codex/kimi 阻断语义：exit 2 + stderr 阻断，其余 exit code fail-open）；
 * - fail-open：stdin 非 JSON / 缺字段 / CommandGate 异常一律放行——宁可漏拦
 *   也不全体 Bash 秒断，拦截层只是纵深防御的一道；
 * - warn/audit 级命中同样放行（只拦 block 级），与生成版行为一致。
 *
 * P1-7（ADR-0031，wayfinder 票08）：判定后对命中写审计 trace（只记账不加新拦截
 * 能力）——此前拦下/放行的危险命令只写 stderr 不落盘，traces.log 里只有约束检查
 * 在写。留痕失败经 try/catch 吞掉，fail-open 口径与 shim 主路径一致。
 *
 * P1-5 harness 半边（ADR-0031，wayfinder 票08）：识别 tool_name 非 Bash 的事件
 * （Edit/Write/apply_patch/MCP 工具，studio 侧补全 codex hooks matcher 后会到达），
 * 只留痕不拦截——这些事件的 tool_input 没有 command 字段，旧形状会因缺字段
 * fail-open 空转；拦截归 codex 沙箱，本 shim 对它们只记账。
 */
import { CommandGate } from './gates/command';
import type { CommandBlacklistRule } from './gates/types';
import { TraceCollector } from './monitoring/traces';

/** hook 标识：与 studio-agent 生成版同一 marker（配置幂等检测共用口径） */
export const HOOK_MARKER = 'harness-command-gate';

interface PreToolUseInput {
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string };
}

/** 一次 PreToolUse 的判定结果：放行结论 + 命中明细（hits 供审计留痕） */
export interface PreToolUseDecision {
  allowed: boolean;
  command: string;
  hits: CommandBlacklistRule[];
  /** provider 工具名（缺省按 Bash 兼容旧事件形状） */
  toolName: string;
  /** 非 Bash 事件的目标路径类字段（file_path；不记内容正文） */
  targetPath?: string;
}

/**
 * 判定一次 PreToolUse 是否放行。
 * block 级命中 → allowed=false；warn/audit/干净命令/坏输入一律 allowed=true。
 * 非 Bash 工具事件（Edit/Write/apply_patch/MCP）恒放行（P1-5：拦截归 codex 沙箱）。
 */
export function decidePreToolUse(rawStdin: string): PreToolUseDecision {
  let input: PreToolUseInput = {};
  try {
    input = JSON.parse(rawStdin || '{}') as PreToolUseInput;
  } catch {
    // 非 JSON stdin：放行
  }
  const toolName = input.tool_name || 'Bash';
  const toolInput = input.tool_input || {};
  if (toolName !== 'Bash') {
    return { allowed: true, command: '', hits: [], toolName, targetPath: toolInput.file_path };
  }
  const command = toolInput.command || '';
  try {
    const gate = new CommandGate();
    // 与 isAllowed 同一谓词（match）：allowed = 无 block 级命中
    const hits = gate.match(command);
    return { allowed: !hits.some((r) => r.level === 'block'), command, hits, toolName };
  } catch {
    // CommandGate 加载/判定异常：fail-open
    return { allowed: true, command, hits: [], toolName };
  }
}

/** 黑名单级别 → trace severity 映射（词表不动 types/trace.ts） */
const SEVERITY_BY_LEVEL = {
  block: 'error',
  warn: 'warning',
  audit: 'info',
} as const;

/**
 * 判定留痕：非 Bash 工具事件一条 `tool-event:<tool>`（P1-5），Bash 命中一条
 * 汇总 trace（P1-7）。
 *
 * 口径选择记理由：
 * - constraintId 用汇总的 'command-gate' 而非每规则 'command-gate:<ruleId>'——
 *   usage-report 按 constraintId 聚合，逐规则会碎成几十个近零样本 id，
 *   污染退役候选诊断；规则明细进 evidence。
 * - evidence 只记规则 id + 命令首 token，不记完整命令文本——命令可能含敏感参数
 *   （token/路径），首 token 足以定位命令类别。
 * - 隐式依赖：TraceCollector 缺省按 cwd 解析 projectPath，hook 进程 cwd 通常是
 *   项目根（provider 在项目根起会话），可接受；写错地方也不拦主路径。
 */
function recordHookTrace(decision: PreToolUseDecision): void {
  try {
    // P1-5：非 Bash 工具事件只留痕不拦截（拦截归 codex 沙箱）——constraintId
    // 按工具名分（tool-event:<tool>），工具集合有界、不会碎片化聚合；evidence
    // 记工具名 + 目标路径类字段（file_path），不记内容正文。
    if (decision.toolName !== 'Bash') {
      new TraceCollector().record({
        constraintId: `tool-event:${decision.toolName}`,
        severity: 'info',
        timestamp: Date.now(),
        result: 'pass',
        operation: 'pretool-use-hook',
        evidence: [
          `tool:${decision.toolName}`,
          ...(decision.targetPath ? [`path:${decision.targetPath}`] : []),
        ],
      });
      return;
    }
    if (decision.hits.length === 0) return;
    const maxLevel = decision.hits.some((r) => r.level === 'block')
      ? 'block'
      : decision.hits.some((r) => r.level === 'warn')
        ? 'warn'
        : 'audit';
    const firstToken = decision.command.trim().split(/\s+/)[0] || '';
    new TraceCollector().record({
      constraintId: 'command-gate',
      severity: SEVERITY_BY_LEVEL[maxLevel],
      timestamp: Date.now(),
      result: decision.allowed ? 'pass' : 'fail',
      operation: 'pretool-use-hook',
      evidence: [
        ...decision.hits.map((r) => `rule:${r.id}`),
        ...(firstToken ? [`cmd:${firstToken}`] : []),
      ],
    });
  } catch {
    // 留痕失败不影响拦截主路径（fail-open 口径与 shim 一致）
  }
}

/**
 * 执行一次 hook：返回进程 exit code（2 = 阻断，0 = 放行）。
 * 阻断时原因写 stderr（provider 把 stderr 作为阻断原因回填模型）。
 */
export function runPreToolUseHook(rawStdin: string): number {
  const decision = decidePreToolUse(rawStdin);
  recordHookTrace(decision);
  if (!decision.allowed) {
    console.error(`[${HOOK_MARKER}] blocked: ${decision.command}`);
    return 2;
  }
  return 0;
}

/* istanbul ignore next -- 进程入口仅做 stdin 收集 + exit，逻辑由 runPreToolUseHook 单测覆盖 */
if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    process.exit(runPreToolUseHook(raw));
  });
}
