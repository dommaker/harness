/**
 * harness constraints reactivate —— 约束复活（ADR-0032 决策 6.5，票 02 断点 5）
 *
 * 复活 = 撤销退休：删 config.yml `constraints.<id>` 墓碑段（与既有"恢复方法"语义一致），
 * 同时写一条 KnowledgeStore 新条目 `constraint-reactivated-<id>`（consumptionMode: 'signal'）
 * ——不改历史：旧 `constraint-retired-<id>` 沉淀原样保留，复活原因单独成条。
 *
 * 幂等口径与 retire 对偶：只认 retired 墓碑。裸 enabled:false（禁用非退休）与
 * 从未退休的约束一律 not_retired，不落盘任何文件。
 *
 * 人确认闸门与 retire 同形（ADR-0001 决策 2 语义）：直达必须显式 --yes。
 * 不提供交互批量模式——复活是低频点对点操作。
 *
 * harness#198：纯执行逻辑（reactivateConstraint 与结果类型）已搬入
 * `core/constraint-lifecycle` 并上公共 barrel；本模块是 CLI 薄壳——打印、
 * 人确认闸门，外加把知识沉淀写口接进 core 的 wired 包装（同 constraints-retire）。
 */

import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import chalk from 'chalk';
import {
  reactivateConstraint as coreReactivateConstraint,
  type ReactivateExecuteOptions,
  type ReactivateResult,
} from '../../core/constraint-lifecycle';
import { logCommitHint, wireKnowledgeSink } from './constraints-retire';

export type {
  ReactivateExecuteOptions,
  ReactivateStatus,
  ReactivateResult,
} from '../../core/constraint-lifecycle';

export interface ConstraintsReactivateOptions {
  projectPath?: string;
  reason?: string;
  /** 直达模式显式确认（--yes）：与 retire 同一道人确认闸门，无此 flag 直达拒绝执行 */
  yes?: boolean;
}

/**
 * CLI 侧 wired 包装的 options：core 执行 options + 知识沉淀写口的输出 IO
 * （io 只被写口接线消费，不是 core 的签名——core ReactivateExecuteOptions 无此字段）
 */
export interface ReactivateCliOptions extends ReactivateExecuteOptions {
  /** 知识沉淀写口的输出 IO（缺省 processIO） */
  io?: CommandIO;
}

/**
 * CLI 侧 wired 包装：core reactivateConstraint + 知识沉淀写口接线
 * （接线共形 = constraints-retire 的 wireKnowledgeSink）。
 */
export function reactivateConstraint(
  projectRoot: string,
  id: string,
  options: ReactivateCliOptions = {}
): ReactivateResult {
  return coreReactivateConstraint(projectRoot, id, wireKnowledgeSink(options));
}

/**
 * 打印单条复活结果
 */
export function printReactivateResult(result: ReactivateResult, io: CommandIO = processIO, projectRoot?: string): CommandResult {
  switch (result.status) {
    case 'unknown_id':
      log(io, chalk.red(`❌ ${result.id}: 约束不存在（内置与应用层约束中都未找到），未做任何变更`));
      return { kind: 'skip', reason: `${result.id}: 约束不存在，未做任何变更` };
    case 'not_retired':
      log(io, chalk.yellow(`⚠️  ${result.id}: 无 retired 墓碑（未退休或仅裸 disable），未做任何变更`));
      return { kind: 'skip', reason: `${result.id}: 无 retired 墓碑，未做任何变更` };
    case 'reactivated': {
      log(io, chalk.green(`✅ ${result.id}: 已复活（config.yml 墓碑段已删，约束回到生效集）`));
      log(io, `   复活沉淀: ${result.knowledgeEntryId}（${result.knowledgeBaseDir}）`);
      if (projectRoot) logCommitHint(projectRoot, io);
      break;
    }
  }
  return { kind: 'ok' };
}

/**
 * CLI handler: harness constraints reactivate <id>
 *
 * 人确认闸门与 retire 同形：直达必须显式 `--yes`，无 `--yes` 报错 + 非零退出码，
 * 不落盘任何文件。
 */
export async function constraintsReactivate(
  id?: string,
  options: ConstraintsReactivateOptions = {},
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectRoot = options.projectPath || process.cwd();

  if (!id) {
    logError(io, chalk.red('❌ 用法：harness constraints reactivate <id> --yes [--reason "..."]（复活是点对点操作，无交互模式）'));
    return { kind: 'usage-error', reason: 'reactivate 缺少约束 id，未做任何变更' };
  }

  if (!options.yes) {
    logError(io,
      chalk.red(`❌ 直达复活需要显式人确认（与 retire 同一闸门），未做任何变更\n`) +
        `   带 --yes 显式确认直达：harness constraints reactivate ${id} --yes` +
        `${options.reason ? ` --reason "${options.reason}"` : ''}`
    );
    return { kind: 'usage-error', reason: `直达复活 ${id} 缺少显式 --yes 人确认，未做任何变更` };
  }

  const result = reactivateConstraint(projectRoot, id, { reason: options.reason, io });
  return printReactivateResult(result, io, projectRoot);
}
