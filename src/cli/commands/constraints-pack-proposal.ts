/**
 * harness constraints pack-proposal <id> —— 升级提案材料打包（ADR-0033 决策 4，块 3 子项 5）
 *
 * 升级通道链路：下游审卡发起/初审 → approve 后由本命令打包脱敏材料 →
 * 人拿材料去 harness 仓开 issue（github 操作留给人，本命令不触网）。
 *
 * 材料内容：条文 + severity + checker 模板与参数 + traces.log 使用统计（只有计数）
 * + 升级理由留白段。
 *
 * 脱敏口径（工具做路径脱敏，内容脱敏归人）：
 * - 项目根绝对路径一律替换为 `<repoRoot>`；
 * - 统计只有计数与首末次日期，不带样本内容；
 * - 应用层约束的 params（正则/glob）**原文带出**并标注"请人工确认无应用内部信息"——
 *   打包工具是质量前置，不是保密闸门。
 *
 * harness#198：材料收集 / 渲染 / 产物命名与落盘已搬入
 * `core/constraints/pack-proposal` 并上公共 barrel（packProposal 返回
 * `{ materialPath, content }`，产物命名规律收敛为库内单一来源）；
 * 本模块是 CLI 薄壳——参数校验、--stdout 通道与结果打印。
 */

import chalk from 'chalk';
import {
  packProposal,
  collectProposalMaterial,
  renderProposalMarkdown,
} from '../../core/constraints/pack-proposal';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

export type { ProposalMaterial, PackProposalResult } from '../../core/constraints/pack-proposal';
export { renderProposalMarkdown } from '../../core/constraints/pack-proposal';

export interface PackProposalOptions {
  projectPath?: string;
  /** 打印到 stdout 而不落盘 */
  stdout?: boolean;
  /** 日期注入（测试用；缺省真实时钟） */
  now?: Date;
}

/**
 * 未知约束 id 的校验失败出口（--stdout 与落盘两通道同文案同 kind）
 */
function unknownConstraintId(id: string, io: CommandIO): CommandResult {
  logError(io, `❌ 未知约束 id: ${id}（内置与应用层 constraints.yml 均未找到），未做任何变更`);
  return { kind: 'usage-error', reason: `未知约束 id: ${id}` };
}

/**
 * CLI handler: harness constraints pack-proposal <id>
 */
export async function constraintsPackProposal(
  id: string | undefined,
  options: PackProposalOptions = {},
  io: CommandIO = processIO
): Promise<CommandResult> {
  const projectRoot = options.projectPath || process.cwd();

  if (!id) {
    logError(io, '❌ 缺少约束 id：harness constraints pack-proposal <id>');
    return { kind: 'usage-error', reason: '缺少约束 id' };
  }

  const now = options.now ?? new Date();

  if (options.stdout) {
    const material = collectProposalMaterial(projectRoot, id);
    if (!material) return unknownConstraintId(id, io);
    log(io, renderProposalMarkdown(material, projectRoot, now));
    return { kind: 'ok' };
  }

  const result = packProposal(projectRoot, id, { now });
  if (!result) return unknownConstraintId(id, io);

  log(io, chalk.green(`✅ 提案材料已生成: ${result.materialPath}`));
  log(io, chalk.gray('   下一步：人工确认 params 无应用内部信息后，拿材料去 harness 仓开 issue（不自动开）'));
  return { kind: 'ok' };
}
