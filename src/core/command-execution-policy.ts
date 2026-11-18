/**
 * 统一命令执行策略（D3，P0.5 Phase 1 副作用授权）
 *
 * check / validate / report 三命令共用同一授权与跳过语义：
 * - createCommandExecutionPolicy：CLI 组合根唯一创建点。readOnly 缺省 false =
 *   默认执行（Phase 1 不改默认行为）；execute 缺省 = 真实 spawn 执行
 *   （由 exec 模板迁入，detached 进程组、超时 SIGKILL、8KiB 流截断语义逐字不动）
 * - skipReason：read-only 跳过原因唯一措辞来源（消费方只透传）
 * - 命令发现（plan*）：项目 YAML 声明命令的清单数据源 + 人读渲染（formatCommandPlan），
 *   三命令共享，不各抄一份。清单只收**会执行**的声明命令：
 *   约束侧 = gate 通道 checker=exec + params.command；检查点侧 = command_success /
 *   command_output 的 config.command + 带 command 的 output_contains /
 *   output_not_contains / output_matches（json_path 当前不执行 command，不纳入）
 * - HTTP（http_status/http_body 的 fetch）是网络请求不是命令执行通道，不纳入清单、
 *   不受 read-only 跳过；custom handlers 与 harness 自身 git 取证同理不混入
 */

import { spawn } from 'child_process';
import type {
  CommandExecutionPolicy,
  CommandExecutor,
  CommandPlanItem,
  ExecutedCommand,
} from '../types/command-execution-policy';
import type { Constraint, ConstraintContext } from '../types/constraint';
import type { Checkpoint, CheckpointCheck } from '../types/checkpoint';
import { isGateConstraint } from './constraints/definitions';
import { matchesTrigger } from './constraints/triggers';

/** stdout/stderr 各自保留的字符上限（超出只记截断标记，不拖垮证据面与 trace） */
const MAX_STREAM_CHARS = 8_192;

/**
 * 真实 shell 命令执行（缺省执行缝）
 *
 * 语义自 exec 模板原样迁入（harness#181 保护面）：detached 成组，超时整组 SIGKILL
 * （shell 的子孙进程一并终止，不留孤儿），stdout/stderr 各至多留 MAX_STREAM_CHARS。
 */
export function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<ExecutedCommand> {
  return new Promise((resolve) => {
    // detached 成组：超时整组 SIGKILL，shell 的子孙进程一并终止，不留孤儿拖住机器
    const child = spawn(command, { cwd, shell: true, detached: true });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const collect = (chunk: Buffer, current: string): string => {
      if (current.length >= MAX_STREAM_CHARS) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString('utf-8');
      if (next.length > MAX_STREAM_CHARS) truncated = true;
      return next.slice(0, MAX_STREAM_CHARS);
    };

    const finish = (partial: { code: number | null; signal: NodeJS.Signals | null; spawnError?: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...partial, timedOut, stdout, stderr, truncated });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // 进程组 kill 失败（竞态：子进程已退，ESRCH）→ 退化单进程 kill，best-effort 收尾
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => { stdout = collect(chunk, stdout); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = collect(chunk, stderr); });
    child.on('error', (err) => finish({ code: null, signal: null, spawnError: err.message }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

/**
 * 创建统一命令执行策略（CLI 组合根唯一创建点）
 *
 * - readOnly 缺省 false：默认执行（Phase 1 不改变默认行为）
 * - execute 注入 = 执行缝（测试注入计数替身，证明 read-only 下零调用；
 *   普通模式证明经替身真实执行）
 * - 库调用方不创建策略 = 消费方缺省默认执行（行为兼容）
 */
export function createCommandExecutionPolicy(options?: {
  readOnly?: boolean;
  execute?: CommandExecutor;
}): CommandExecutionPolicy {
  return {
    readOnly: options?.readOnly ?? false,
    skipReason: (command) => `--read-only：跳过命令执行（未执行）：${command}`,
    execute: options?.execute ?? runShellCommand,
  };
}

/**
 * 检查点侧会执行声明命令的 check type（判别联合收窄）
 *
 * json_path 刻意不在列：当前实现不执行 config.command（未裁决不改），
 * 不纳入清单也不被 read-only 跳过。
 */
function checkpointCheckCommand(check: CheckpointCheck): string | undefined {
  switch (check.type) {
    case 'command_success':
    case 'command_output':
      // command 是这两族的必填字段（加载期 assertCheckpointShape 校验）
      return check.config.command;
    case 'output_contains':
    case 'output_not_contains':
    case 'output_matches': {
      const command = check.config.command;
      return typeof command === 'string' && command.length > 0 ? command : undefined;
    }
    default:
      // file_* / json_path / http_* / custom：不执行项目声明命令
      return undefined;
  }
}

/**
 * 从生效约束集提取声明命令清单（check / report 的运行前清单数据源）
 *
 * 只收 gate 通道 checker=exec 且 params.command 非空的条目；workflow/discipline
 * 通道不进入检查分发，不执行，不进清单。
 *
 * **触发域过滤与 checker 分发同口径**（review 回修）：context 必填，按
 * `[operation, ...extraTriggers]` 过 `matchesTrigger`——清单只列本次真正会
 * 分发（将执行/跳过）的命令，trigger 不匹配的约束不进清单也不执行。
 */
export function planCommandsFromConstraints(
  constraints: Record<string, Constraint> | undefined,
  context: ConstraintContext
): CommandPlanItem[] {
  // 与 ConstraintChecker.findApplicableConstraints 同一 operations 口径
  const operations = [context.operation, ...(context.extraTriggers ?? [])];
  const plan: CommandPlanItem[] = [];
  for (const constraint of Object.values(constraints ?? {})) {
    if (!isGateConstraint(constraint)) continue;
    if (!matchesTrigger(constraint, operations)) continue;
    if (constraint.checker !== 'exec') continue;
    const command = constraint.params?.command;
    if (typeof command === 'string' && command.length > 0) {
      plan.push({ source: constraint.id, command });
    }
  }
  return plan;
}

/**
 * 从检查点列表提取声明命令清单（validate 的运行前清单数据源）
 *
 * 只收会执行 config.command 的族：command_success / command_output（command 必填）
 * 与带 command 的 output_contains / output_not_contains / output_matches。
 * json_path 当前不执行 command（未裁决不改），不纳入清单也不被 read-only 跳过。
 */
export function planCommandsFromCheckpoints(checkpoints: Checkpoint[]): CommandPlanItem[] {
  const plan: CommandPlanItem[] = [];
  for (const checkpoint of checkpoints) {
    for (const check of checkpoint.checks ?? []) {
      const command = checkpointCheckCommand(check);
      if (command !== undefined) {
        plan.push({ source: `${checkpoint.id}/${check.id}`, command });
      }
    }
  }
  return plan;
}

/** 清单渲染（人读行形状对外可见，由测试钉住） */
export function formatCommandPlan(plan: CommandPlanItem[]): string[] {
  return plan.map(item => `   - ${item.command}（${item.source}）`);
}
