/**
 * harness constraints pack-proposal <id> —— 升级提案材料打包（ADR-0033 决策 4，块 3 子项 5）
 *
 * 升级通道链路：studio 审卡发起/初审 → approve 后由本命令打包脱敏材料 →
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
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import chalk from 'chalk';
import { getConstraint } from '../../core/constraints/definitions';
import { loadAppConstraints } from '../../core/app-constraints-loader';
import { collectUsageByConstraint, readProjectTraces } from '../../core/constraints/usage-report';
import type { Constraint } from '../../types/constraint';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface PackProposalOptions {
  projectPath?: string;
  /** 打印到 stdout 而不落盘 */
  stdout?: boolean;
  /** 日期注入（测试用；缺省真实时钟） */
  now?: Date;
}

/** 提案材料的输入（查找结果 + 使用统计聚合） */
export interface ProposalMaterial {
  constraint: Constraint;
  stats: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    evaluated: number;
    firstAt?: number;
    lastAt?: number;
  };
}

/**
 * 查找约束定义（内置 + 应用层，与 findRetireTarget 同口径但带全量字段——
 * checker/params 是提案材料的核心内容，RetireTargetInfo 不带）
 */
function findProposalTarget(id: string, projectRoot: string): Constraint | undefined {
  const builtIn = getConstraint(id);
  if (builtIn) return builtIn;
  return loadAppConstraints(projectRoot).find(c => c.id === id);
}

function formatDate(ts: number | undefined): string {
  return ts === undefined ? '（无记录）' : new Date(ts).toISOString().slice(0, 10);
}

/**
 * 渲染脱敏提案材料 markdown（纯函数，导出供测试）
 *
 * @param projectRoot 用于路径脱敏（材料中出现的项目根绝对路径替换为 `<repoRoot>`）
 */
export function renderProposalMarkdown(
  material: ProposalMaterial,
  projectRoot: string,
  now: Date = new Date()
): string {
  const c = material.constraint;
  const s = material.stats;
  const isApp = c.source === 'app';

  const lines: string[] = [];
  lines.push(`# 约束升级提案材料：${c.id}`);
  lines.push('');
  lines.push(`- 生成日期: ${now.toISOString().slice(0, 10)}`);
  lines.push(`- 来源: ${isApp ? '应用层（.harness/constraints.yml）' : '内置'}`);
  lines.push(`- severity: ${c.severity}`);
  lines.push('');

  lines.push('## 条文');
  lines.push('');
  lines.push(`rule: ${c.rule}`);
  if (c.message && c.message !== c.rule) lines.push(`message: ${c.message}`);
  if (c.description) lines.push(`description: ${c.description}`);
  lines.push('');

  lines.push('## checker');
  lines.push('');
  if (isApp) {
    lines.push(`模板: \`${c.checker}\``);
    lines.push('');
    lines.push('参数（原文带出，**请人工确认无应用内部信息**——工具只做路径脱敏，内容脱敏归人）:');
    lines.push('');
    lines.push('```yaml');
    lines.push(yaml.dump(c.params ?? {}, { lineWidth: 120 }).trimEnd());
    lines.push('```');
  } else {
    lines.push('内置定制 checker（按约束 id 注册，非参数化模板）。升级到通用层前需评审：');
    lines.push('改写为模板 + 参数，或作为通用规则保留定制实现。');
  }
  lines.push('');

  lines.push('## 使用统计（traces.log 聚合，只有计数）');
  lines.push('');
  lines.push(`- total: ${s.total}`);
  lines.push(`- evaluated: ${s.evaluated}（pass ${s.pass} / fail ${s.fail} / skip ${s.skip}）`);
  lines.push(`- 首次触发: ${formatDate(s.firstAt)}`);
  lines.push(`- 最近触发: ${formatDate(s.lastAt)}`);
  lines.push('');

  lines.push('## 升级理由');
  lines.push('');
  lines.push('> （请在此填写：为什么这条约束该进通用层——适用面、证据、与其他仓的相关性）');
  lines.push('');

  // 路径脱敏：项目根绝对路径一律替换
  return lines.join('\n').split(projectRoot).join('<repoRoot>');
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

  const constraint = findProposalTarget(id, projectRoot);
  if (!constraint) {
    logError(io, `❌ 未知约束 id: ${id}（内置与应用层 constraints.yml 均未找到），未做任何变更`);
    return { kind: 'usage-error', reason: `未知约束 id: ${id}` };
  }

  const usage = collectUsageByConstraint(readProjectTraces(projectRoot)).get(id);
  const stats = {
    total: usage?.total ?? 0,
    pass: usage?.pass ?? 0,
    fail: usage?.fail ?? 0,
    skip: usage?.skip ?? 0,
    evaluated: (usage?.total ?? 0) - (usage?.skip ?? 0),
    firstAt: usage?.firstAt,
    lastAt: usage?.lastAt,
  };

  const now = options.now ?? new Date();
  const markdown = renderProposalMarkdown({ constraint, stats }, projectRoot, now);

  if (options.stdout) {
    log(io, markdown);
    return { kind: 'ok' };
  }

  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const outPath = path.join(projectRoot, '.harness', 'reports', `proposal-${id}-${date}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, 'utf-8');
  log(io, chalk.green(`✅ 提案材料已生成: ${outPath}`));
  log(io, chalk.gray('   下一步：人工确认 params 无应用内部信息后，拿材料去 harness 仓开 issue（不自动开）'));
  return { kind: 'ok' };
}
