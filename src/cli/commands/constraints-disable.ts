/**
 * harness constraints disable —— 约束裸禁用（harness#190，ADR-0032 决策 6.6 的另一侧）
 *
 * 裸禁用 = config.yml `constraints.<id>.enabled:false`，无 retired 墓碑、无知识沉淀
 * （墓碑与沉淀是 retire 专有语义）。与 retire 的分工：
 *
 * - disable：临时停用，幂等 already_disabled，不写沉淀；恢复 = 删 enabled 键
 * - retire：永久退役，写 retired 墓碑 + `constraint-retired-<id>` 沉淀；
 *   对裸 disabled 条目会接管补墓碑+沉淀（constraints-retire.ts 头部注释）
 *
 * 语义与下游消费方 applier 的 applyDisable 对齐（经下游裁定
 * config.yml 归 harness，本命令是下游切换的落点）：
 * 只认内置 + 应用层（.harness/constraints.yml）check 约束（findRetireTarget 同路径，
 * ADR-0033）；写后验证生效集已缩小，失败回滚备份。
 *
 * retired 墓碑不接管不动：已退役条目返回 already_retired（要恢复请 reactivate）。
 * 人确认闸门与 retire/reactivate 同形（ADR-0001 决策 2）：直达必须显式 --yes，
 * 不提供交互模式——禁用是低频点对点操作（同 reactivate 定位）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import chalk from 'chalk';
import { ProjectConfigLoader } from '../../core/project-config-loader';
import { isRetiredTombstone } from '../../core/retired-constraints';
import { getEffectiveConstraints } from '../../core/effective-constraints';
import { findRetireTarget, logCommitHint, setYamlEntry } from './constraints-retire';

export type DisableStatus =
  | 'disabled'
  | 'already_disabled'
  | 'already_retired'
  | 'unknown_id'
  | 'verify_failed';

export interface DisableResult {
  id: string;
  status: DisableStatus;
}

export interface ConstraintsDisableOptions {
  projectPath?: string;
  /** 直达模式显式确认（--yes）：与 retire/reactivate 同一道人确认闸门，无此 flag 直达拒绝执行 */
  yes?: boolean;
}

/**
 * 执行单条约束裸禁用（纯执行逻辑，无交互）
 *
 * 不存在的 id / 已禁用 / 已退役的 id 通过 status 返回，由调用方提示。
 */
export function disableConstraint(projectRoot: string, id: string): DisableResult {
  const target = findRetireTarget(id, projectRoot);
  if (!target) {
    return { id, status: 'unknown_id' };
  }

  // 幂等口径（ADR-0032 决策 6.6）：retired 墓碑优先判定——disable 不动墓碑不吞退休语义；
  // 裸 enabled:false 即已禁用。判定谓词唯一实现 = isRetiredTombstone
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const existing = loader.getConfig().constraints?.[id] as { enabled?: boolean; retired?: unknown } | undefined;
  if (isRetiredTombstone(existing)) {
    return { id, status: 'already_retired' };
  }
  if (existing?.enabled === false) {
    return { id, status: 'already_disabled' };
  }

  // 1. 落盘裸禁用（config.yml enabled:false，无 retired 段；同文件其他条目不动）
  const configPath = path.join(projectRoot, '.harness', 'config.yml');
  const backup = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
  setYamlEntry(configPath, 'config.yml', 'constraints', id, { enabled: false });

  // 2. 写后验证：生效集必须已缩小（与下游 applier 同一纪律），失败回滚备份
  try {
    if (getEffectiveConstraints(projectRoot).some(c => c.id === id)) {
      throw new Error('constraint still present in effective set after disable');
    }
  } catch {
    if (backup !== null) fs.writeFileSync(configPath, backup, 'utf-8');
    else fs.rmSync(configPath, { force: true });
    return { id, status: 'verify_failed' };
  }

  return { id, status: 'disabled' };
}

/**
 * 打印单条禁用结果
 */
export function printDisableResult(result: DisableResult, io: CommandIO = processIO, projectRoot?: string): CommandResult {
  switch (result.status) {
    case 'unknown_id':
      log(io, chalk.red(`❌ ${result.id}: 约束不存在（内置与应用层约束中都未找到），未做任何变更`));
      return { kind: 'skip', reason: `${result.id}: 约束不存在，未做任何变更` };
    case 'already_disabled':
      log(io, chalk.yellow(`⚠️  ${result.id}: 已处于禁用状态（config.yml enabled:false 无墓碑），跳过`));
      return { kind: 'skip', reason: `${result.id}: 已处于禁用状态，跳过` };
    case 'already_retired':
      log(io, chalk.yellow(`⚠️  ${result.id}: 已处于退役状态（有 retired 墓碑）——disable 不动墓碑，未做任何变更；要恢复请 harness constraints reactivate ${result.id} --yes`));
      return { kind: 'skip', reason: `${result.id}: 已处于退役状态，未做任何变更` };
    case 'verify_failed':
      logError(io, chalk.red(`❌ ${result.id}: 禁用后约束仍在生效集，写后验证失败，已回滚 config.yml`));
      return { kind: 'fail', reason: `${result.id}: disable 写后验证失败，已回滚 config.yml` };
    case 'disabled': {
      log(io, chalk.green(`✅ ${result.id}: 已禁用（config.yml enabled:false，无 retired 墓碑、无知识沉淀）`));
      log(io, chalk.gray(`   disable 是裸禁用不是退役——恢复：删 config.yml constraints.${result.id} 的 enabled 键；要永久退役走 harness constraints retire ${result.id}（会接管补墓碑+沉淀）`));
      if (projectRoot) logCommitHint(projectRoot, io);
      break;
    }
  }
  return { kind: 'ok' };
}

/**
 * CLI handler: harness constraints disable <id>
 *
 * 人确认闸门与 retire/reactivate 同形：直达必须显式 `--yes`，无 `--yes` 报错 +
 * 非零退出码，不落盘任何文件。无交互模式（点对点操作，同 reactivate）。
 */
export async function constraintsDisable(
  id?: string,
  options: ConstraintsDisableOptions = {},
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectRoot = options.projectPath || process.cwd();

  if (!id) {
    logError(io, chalk.red('❌ 用法：harness constraints disable <id> --yes（禁用是点对点操作，无交互模式）'));
    return { kind: 'usage-error', reason: 'disable 缺少约束 id，未做任何变更' };
  }

  if (!options.yes) {
    logError(io,
      chalk.red(`❌ 直达禁用需要显式人确认（与 retire 同一闸门），未做任何变更\n`) +
        `   带 --yes 显式确认直达：harness constraints disable ${id} --yes`
    );
    return { kind: 'usage-error', reason: `直达禁用 ${id} 缺少显式 --yes 人确认，未做任何变更` };
  }

  const result = disableConstraint(projectRoot, id);
  return printDisableResult(result, io, projectRoot);
}
