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
 * - CommandGate.isAllowed 判定 block 级黑名单，命中 → stderr 写原因 + exit 2
 *   （codex/kimi 阻断语义：exit 2 + stderr 阻断，其余 exit code fail-open）；
 * - fail-open：stdin 非 JSON / 缺字段 / CommandGate 异常一律放行——宁可漏拦
 *   也不全体 Bash 秒断，拦截层只是纵深防御的一道；
 * - warn/audit 级命中同样放行（isAllowed 只看 block 级），与生成版行为一致。
 */
import { CommandGate } from './gates/command';

/** hook 标识：与 studio-agent 生成版同一 marker（配置幂等检测共用口径） */
export const HOOK_MARKER = 'harness-command-gate';

interface PreToolUseInput {
  tool_input?: { command?: string };
}

/**
 * 判定一次 PreToolUse 是否放行。
 * block 级命中 → allowed=false；warn/audit/干净命令/坏输入一律 allowed=true。
 */
export function decidePreToolUse(rawStdin: string): { allowed: boolean; command: string } {
  let input: PreToolUseInput = {};
  try {
    input = JSON.parse(rawStdin || '{}') as PreToolUseInput;
  } catch {
    // 非 JSON stdin：放行
  }
  const command = (input.tool_input && input.tool_input.command) || '';
  try {
    const gate = new CommandGate();
    return { allowed: gate.isAllowed(command), command };
  } catch {
    // CommandGate 加载/判定异常：fail-open
    return { allowed: true, command };
  }
}

/**
 * 执行一次 hook：返回进程 exit code（2 = 阻断，0 = 放行）。
 * 阻断时原因写 stderr（provider 把 stderr 作为阻断原因回填模型）。
 */
export function runPreToolUseHook(rawStdin: string): number {
  const { allowed, command } = decidePreToolUse(rawStdin);
  if (!allowed) {
    console.error(`[${HOOK_MARKER}] blocked: ${command}`);
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
