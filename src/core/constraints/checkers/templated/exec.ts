/**
 * exec 模板：外部命令执行协议（harness#181，ADR-0035 决策 3 探测器来源 exec 档）
 *
 * 名册条目：checker: exec + params: { command: "node .harness/checkers/foo.mjs" }。
 * harness 只负责跑命令、看退出码：0 = 满足，非 0 = 违规；脚本的 stdout/stderr 行进证据。
 * 业务判定脚本放业务仓，业务知识不出仓；跑的是项目自己仓的脚本，无新信任边界
 * （协议形状与 git hook / CI 同源）。
 *
 * 保护面（命令失控不拖死检查流程）：
 * - 超时：到点杀整个进程组（含 shell 的子孙进程）并判违规
 * - 截断：stdout/stderr 各至多留 MAX_STREAM_CHARS，超出只记「已截断」标记
 *
 * 命令执行策略（D3 P0.5 Phase 1）：env.commandPolicy.readOnly = true 时不执行
 * 命令，返回三态 CheckSkip（原因由策略统一措辞）；普通模式经策略执行缝执行
 * （缺省真实 spawn 执行，语义如上；无策略 = 默认执行，库调用兼容）。
 *
 * 参数：
 * - command（必填）：命令行（经 shell 执行，cwd = 项目根）
 * - timeoutMs（可选）：超时毫秒数，缺省 DEFAULT_TIMEOUT_MS，上限 MAX_TIMEOUT_MS
 */

import {
  formatEvidence,
  type CheckDetail,
  type ConstraintCheck,
  type TemplatedCheckerFactory,
} from '../types';
import { runShellCommand } from '../../../command-execution-policy';
import { clip } from '../../../../utils/clip';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;

/** 失败原因一行话（自描述，进证据首行） */
function failureReason(command: string, result: Awaited<ReturnType<typeof runShellCommand>>, timeoutMs: number): string {
  if (result.spawnError) return `命令启动失败（${result.spawnError}）：${command}`;
  if (result.timedOut) return `命令超时（>${timeoutMs}ms）已终止：${command}`;
  if (result.signal) return `命令被信号 ${result.signal} 终止：${command}`;
  return `命令退出码 ${result.code}：${command}`;
}

export const execScript: TemplatedCheckerFactory = {
  validateParams(params) {
    const errors: string[] = [];
    if (typeof params.command !== 'string' || params.command.length === 0) {
      errors.push('command 必填（非空字符串，如 "node .harness/checkers/foo.mjs"）');
    }
    if (params.timeoutMs !== undefined) {
      const t = params.timeoutMs;
      if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > MAX_TIMEOUT_MS) {
        errors.push(`timeoutMs 必须是 1–${MAX_TIMEOUT_MS} 的毫秒数`);
      }
    }
    return errors;
  },

  create(id, params): ConstraintCheck {
    const command = params.command as string;
    const timeoutMs = (params.timeoutMs as number | undefined) ?? DEFAULT_TIMEOUT_MS;

    return {
      id,
      async evaluate(env) {
        // read-only：不执行项目声明命令，三态 skipped（不计 pass/fail，不假绿）
        const policy = env.commandPolicy;
        if (policy?.readOnly) {
          return { skip: true, reason: policy.skipReason(command) };
        }
        const result = await (policy ? policy.execute : runShellCommand)(command, env.projectPath, timeoutMs);
        if (!result.timedOut && !result.spawnError && result.code === 0) return true;

        const lines: string[] = [];
        for (const line of result.stderr.split('\n').filter(Boolean)) lines.push(`stderr: ${clip(line)}`);
        for (const line of result.stdout.split('\n').filter(Boolean)) lines.push(`stdout: ${clip(line)}`);
        const summary = failureReason(command, result, timeoutMs) +
          (result.truncated ? '（输出过长，已截断）' : '');
        const detail: CheckDetail = {
          pass: false,
          evidence: formatEvidence(summary, lines),
        };
        return detail;
      },
    };
  },
};
