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
 */

import * as path from 'path';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import chalk from 'chalk';
import { ProjectConfigLoader } from '../../core/project-config-loader';
import type { KnowledgeEntry } from '../../knowledge/types';
import { openKnowledgeStore } from './knowledge-view';
import { findRetireTarget, logCommitHint, removeYamlEntry, type RetireTargetInfo } from './constraints-retire';

export interface ReactivateExecuteOptions {
  /** 复活原因（可空） */
  reason?: string;
  /** 注入当前时间（测试用） */
  now?: Date;
  /** 知识库路径解析的 io（缺省 processIO，与 retire 写口同形） */
  io?: CommandIO;
}

export type ReactivateStatus = 'reactivated' | 'not_retired' | 'unknown_id';

export interface ReactivateResult {
  id: string;
  status: ReactivateStatus;
  /** KnowledgeStore 条目 id（status='reactivated' 时存在） */
  knowledgeEntryId?: string;
  /** 复活记录实际落盘的知识库根（status='reactivated' 时存在） */
  knowledgeBaseDir?: string;
}

export interface ConstraintsReactivateOptions {
  projectPath?: string;
  reason?: string;
  /** 直达模式显式确认（--yes）：与 retire 同一道人确认闸门，无此 flag 直达拒绝执行 */
  yes?: boolean;
}

/**
 * 写 KnowledgeStore 复活记录（consumptionMode: 'signal'）
 *
 * baseDir 走 openKnowledgeStore 同一解析点，与 retire 沉淀写口同根。
 */
function saveReactivateKnowledge(
  id: string,
  target: RetireTargetInfo,
  reason: string,
  iso: string,
  io: CommandIO
): { entryId: string; baseDir: string } {
  const entryId = `constraint-reactivated-${id}`;
  const contentLines = [
    `# 约束复活：${id}`,
    '',
    `原退役沉淀：constraint-retired-${id}（不改历史，原条目保留）`,
    '',
    '## 规则原文',
    '',
    target.description ? `description: ${target.description}` : undefined,
    target.rule ? `rule: ${target.rule}` : undefined,
    target.message ? `message: ${target.message}` : undefined,
    '',
    '## 复活原因',
    '',
    reason || '（未填写）',
    '',
    `复活日期: ${iso}`,
  ].filter((l): l is string => l !== undefined);

  const entry: KnowledgeEntry = {
    id: entryId,
    type: 'decision',
    title: `约束复活：${id}`,
    content: contentLines.join('\n'),
    maturity: 'verified',
    layer: 'project',
    created: iso,
    lastReferenced: iso,
    contributors: [],
    projects: [],
    tags: ['constraint-reactivated', `constraint:${id}`, `severity:${target.severity}`],
    applicablePhases: [],
    sourceReferences: [{ timestamp: iso }],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'signal',
    origin: 'human',
  };

  const store = openKnowledgeStore({}, io);
  store.save(entry);
  return { entryId, baseDir: store.getBaseDir() };
}

/**
 * 执行单条约束复活（纯执行逻辑，无交互）
 *
 * 不存在的 id / 无 retired 墓碑的 id 通过 status 返回，由调用方提示。
 */
export function reactivateConstraint(
  projectRoot: string,
  id: string,
  options: ReactivateExecuteOptions = {}
): ReactivateResult {
  const now = options.now ?? new Date();
  const iso = now.toISOString();

  const target = findRetireTarget(id);
  if (!target) {
    return { id, status: 'unknown_id' };
  }

  // 只认 retired 墓碑：裸 disable 与未配置一律 not_retired（与 retire 的幂等口径对偶）
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const existing = loader.getConfig().constraints?.[id] as { enabled?: boolean; retired?: unknown } | undefined;
  if (!(existing?.enabled === false && existing.retired)) {
    return { id, status: 'not_retired' };
  }

  // 1. 删 config.yml constraints.<id> 墓碑段（恢复 = 回生效集）
  removeYamlEntry(path.join(projectRoot, '.harness', 'config.yml'), 'constraints', id);

  // 2. KnowledgeStore 复活条目（不改历史，新写一条）
  const { entryId: knowledgeEntryId, baseDir: knowledgeBaseDir } = saveReactivateKnowledge(
    id,
    target,
    options.reason ?? '',
    iso,
    options.io ?? processIO
  );

  return { id, status: 'reactivated', knowledgeEntryId, knowledgeBaseDir };
}

/**
 * 打印单条复活结果
 */
export function printReactivateResult(result: ReactivateResult, io: CommandIO = processIO, projectRoot?: string): CommandResult {
  switch (result.status) {
    case 'unknown_id':
      log(io, chalk.red(`❌ ${result.id}: 约束不存在（非内置约束），未做任何变更`));
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
