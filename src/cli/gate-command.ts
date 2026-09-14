/**
 * 门禁命令共享面（架构评审候选1）
 *
 * 六个门禁命令原先各写一遍「报告 → 成败」的翻译与 ✓/✗ 输出，同一句话抄 6 处。
 * 这里只留一份：`GateDecision → CommandResult` 的唯一映射，加人类视图骨架。
 *
 * `command` 门禁的输出是单行机器友好形态（自带 ✓/✗ 与 --json），只复用映射、
 * 不套骨架——套的话等于逼它换掉已对外的输出形状。
 */

import chalk from 'chalk';
import type { GateDecision, GateResult } from '../gates/types';
import { log, type CommandIO, type CommandResult } from './command-contract';

/**
 * 门禁命令的人类视图
 */
export interface GateCommandView {
  /** 门禁 id（与注册表一致），决定失败 reason 的前缀 */
  gateId: string;
  /** 横幅用词，如「代码审查门控」「验收标准」 */
  label: string;
  /** 通过时追加的指标行（自行上色，空串表示空行） */
  onPass?: (result: GateResult) => string[];
  /** 未通过时在原因行之后追加的详情行 */
  onFail?: (result: GateResult) => string[];
}

/**
 * 决策 → 命令结果：六个门禁唯一一处映射
 */
export function gateCommandResult(gateId: string, decision: GateDecision): CommandResult {
  if (decision.status === 'abstain') {
    return { kind: 'ok' };
  }
  // ask 无实现者，按拦下计——与 runGates 的 fail-closed 聚合同一条规则
  return { kind: 'fail', reason: `${gateId} gate denied: ${decision.result.message}` };
}

/**
 * 打印决策并给出命令结果
 */
export function reportGateDecision(
  io: CommandIO,
  view: GateCommandView,
  decision: GateDecision
): CommandResult {
  const result = decision.result;
  log(io);

  if (decision.status === 'abstain') {
    log(io, chalk.green(`✅ ${view.label}检查通过`));
    for (const line of view.onPass?.(result) ?? []) {
      log(io, line);
    }
  } else {
    log(io, chalk.red(`❌ ${view.label}检查失败`));
    log(io, chalk.red(`   ${result.message}`));
    for (const line of view.onFail?.(result) ?? []) {
      log(io, line);
    }
  }

  return gateCommandResult(view.gateId, decision);
}

/**
 * 门禁自身之外的抛出物（git / fs）→ 出错横幅 + fail
 */
export function reportGateError(
  io: CommandIO,
  gateId: string,
  label: string,
  error: unknown,
  extra?: (message: string) => string[]
): CommandResult {
  const message = error instanceof Error ? error.message : String(error);

  log(io);
  log(io, chalk.red(`❌ ${label}检查出错`));
  log(io, chalk.red(`   ${message}`));
  for (const line of extra?.(message) ?? []) {
    log(io, line);
  }

  return { kind: 'fail', reason: `${gateId} gate error: ${message}` };
}
