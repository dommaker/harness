/**
 * 约束变更面库函数（harness#198）：retire / reactivate / disable
 *
 * 三个执行函数自 cli 命令模块搬入 core 并上公共 barrel，CLI 命令是调用本模块的
 * 薄壳；后续在其上叠加写后验证与观察期备份（见下）。下游消费方
 * 不再直读直写 `.harness/config.yml`。
 *
 * 语义（与搬家前一致，详见各函数）：
 * - retire：永久退役——config.yml `enabled:false` + `retired` 墓碑 + 知识沉淀；
 *   裸 disabled 条目会被接管补墓碑+沉淀（ADR-0032 决策 6.6）；
 *   写后双验证（下游配置公共化）：生效集已缩小 + retired 墓碑在场，无知识 sink 的
 *   库路径同样验证；失败恢复写前内容并返回显式 `verify_failed`
 * - reactivate：撤销退休——删墓碑段回生效集 + 写复活沉淀（不改历史，ADR-0032 决策 6.5）
 * - disable：裸禁用——`enabled:false` 无墓碑无沉淀；retired 墓碑不动
 *
 * 观察期备份（下游配置公共化）：retire/disable 接受可选 `createBackup`——请求时写前
 * 建 config.yml 磁盘备份（`<path>.bak-<时间戳>`）并在结果返回 `observation`
 * （targetPath/backupPath/beforeHash/afterHash，可经 `restoreConfig` 条件回滚）；
 * 缺省不建备份、结果形状不变；幂等路径（already_*）不留备份。
 *
 * 知识沉淀写口是**注入 seam**（harness#88 分层纪律：core 不 value-import 知识层）：
 * retire/reactivate 经 `options.openKnowledgeStore` 工厂取写口，缺省（未注入）只落
 * config.yml、不写沉淀——与 ConstraintChecker 的 unwired 实例同一纪律，组合根
 * （CLI 命令、下游编排侧）负责接线。
 */

import * as fs from 'fs';
import * as path from 'path';
import { findConstraintDefinition } from './constraints/find-constraint';
import { ProjectConfigLoader } from './project-config-loader';
import { isRetiredTombstone } from './retired-constraints';
import { getEffectiveConstraints } from './effective-constraints';
import type { RunTarget } from './constraints/run-env';
import type { Constraint } from '../types/constraint';
import type { KnowledgeEntry } from '../knowledge/types';
import { setYamlEntry, removeYamlEntry } from '../utils/yaml-edit';
import * as yaml from '../utils/yaml';
import { collectUsageByConstraint, readProjectTracesReport } from './constraints/usage-report';
import { backupConfigFile, hashConfigContent, type ConfigObservation } from './config-fingerprint';

/**
 * 知识沉淀写口（注入 seam）：`FileKnowledgeStore` 结构化满足。
 * 经工厂注入（`openKnowledgeStore`）而非实例——写口只在真正落沉淀时开启，
 * unknown_id / already_retired 等路径零副作用。
 */
export interface LifecycleKnowledgeSink {
  save(entry: KnowledgeEntry): void;
  getBaseDir(): string;
}

export interface RetireExecuteOptions {
  /** 退役原因（可空） */
  reason?: string;
  /** 注入当前时间（测试用；同时用作观察期备份文件名时间戳） */
  now?: Date;
  /**
   * 知识沉淀写口工厂（harness#88 注入纪律）。注入 = 退休时写 `constraint-retired-<id>`
   * 沉淀（consumptionMode: 'signal'）；缺省 = 只落 config.yml 墓碑，不写沉淀
   */
  openKnowledgeStore?: () => LifecycleKnowledgeSink;
  /**
   * 观察期备份（下游配置公共化）：请求时写前建 config.yml 磁盘备份，成功结果带
   * `observation` 元数据（可经 `restoreConfig` 条件回滚）；缺省不建备份、结果形状不变。
   * 幂等路径（already_retired）与 unknown_id 不建备份、不带 observation
   */
  createBackup?: boolean;
}

export type RetireStatus = 'retired' | 'already_retired' | 'unknown_id' | 'verify_failed';

export interface RetireResult {
  id: string;
  status: RetireStatus;
  /** 是否 severity='error'（交互模式据此追加确认） */
  isError: boolean;
  stats: { total: number; fail: number; failRate: number };
  /** KnowledgeStore 条目 id（status='retired' 且注入了写口时存在） */
  knowledgeEntryId?: string;
  /** 退役记录实际落盘的知识库根（status='retired' 且注入了写口时存在，harness#177） */
  knowledgeBaseDir?: string;
  /** 观察期备份元数据（仅 `createBackup` 请求且 status='retired' 时存在，下游配置公共化） */
  observation?: ConfigObservation;
}

export interface RetireTargetInfo {
  severity: Constraint['severity'];
  description?: string;
  rule?: string;
  message?: string;
  /** 约束来源（ADR-0033）：app 层退休沉淀条目 tags 加 source:app */
  source?: Constraint['source'];
}

/**
 * 查找约束定义（内置 definitions + 应用层 constraints.yml，ADR-0033）
 *
 * 查找单一口径 = `constraints/find-constraint`（原与 pack-proposal 同形两份，已并）；
 * 本函数是它的 RetireTargetInfo 投影。
 *
 * loader 由调用方给（一次退役一份观察面，见 retireConstraint）：本函数只读它的装载结果，
 * 不再自造 ProjectConfigLoader。应用层查找经 target 参数（项目根路径或观察面），
 * 不传 = 只查内置（历史行为）。
 */
export function findRetireTarget(id: string, target?: RunTarget): RetireTargetInfo | undefined {
  const c = findConstraintDefinition(id, target);
  if (!c) return undefined;
  return {
    severity: c.severity,
    description: c.description,
    rule: c.rule,
    message: c.message,
    source: c.source ?? 'builtin',
  };
}

/**
 * 读 config.yml `constraints.<id>` 条目（retire/reactivate/disable 三处墓碑与
 * 幂等判定共用）；缺段 = undefined
 */
function loadConstraintEntry(
  loader: ProjectConfigLoader,
  id: string
): { enabled?: boolean; retired?: unknown } | undefined {
  return loader.getConfig().constraints?.[id] as { enabled?: boolean; retired?: unknown } | undefined;
}

/**
 * 写知识沉淀条目（consumptionMode: 'signal'）
 *
 * 写口由调用方注入（harness#88）；条目 id 由本函数按 `<prefix>-<id>` 构造并返回，
 * 落盘根取写口自报的 baseDir。
 */
function saveLifecycleKnowledge(
  sink: LifecycleKnowledgeSink,
  entryId: string,
  title: string,
  contentLines: (string | undefined)[],
  tags: string[],
  iso: string
): { entryId: string; baseDir: string } {
  const entry: KnowledgeEntry = {
    id: entryId,
    type: 'decision',
    title,
    content: contentLines.filter((l): l is string => l !== undefined).join('\n'),
    maturity: 'verified',
    layer: 'project',
    created: iso,
    lastReferenced: iso,
    contributors: [],
    projects: [],
    tags,
    applicablePhases: [],
    sourceReferences: [{ timestamp: iso }],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'signal',
    origin: 'human',
  };
  sink.save(entry);
  return { entryId, baseDir: sink.getBaseDir() };
}

/** 退休沉淀条目（约束规则原文 + 退役原因 + 历史统计） */
function saveRetireKnowledge(
  sink: LifecycleKnowledgeSink,
  id: string,
  target: RetireTargetInfo,
  reason: string,
  stats: { total: number; fail: number; failRate: number },
  iso: string
): { entryId: string; baseDir: string } {
  return saveLifecycleKnowledge(
    sink,
    `constraint-retired-${id}`,
    `约束退役：${id}`,
    [
      `# 约束退役：${id}`,
      '',
      '## 规则原文',
      '',
      target.description ? `description: ${target.description}` : undefined,
      target.rule ? `rule: ${target.rule}` : undefined,
      target.message ? `message: ${target.message}` : undefined,
      '',
      '## 退役原因',
      '',
      reason || '（未填写）',
      '',
      '## 历史统计',
      '',
      `- total: ${stats.total}`,
      `- fail: ${stats.fail}`,
      `- failRate: ${Math.round(stats.failRate * 100)}%`,
      '',
      `退役日期: ${iso}`,
    ],
    // ADR-0033：应用层退休沉淀带 source:app 标签（内置条目不加，历史形状不动）
    [
      'constraint-retired',
      `constraint:${id}`,
      `severity:${target.severity}`,
      ...(target.source === 'app' ? ['source:app'] : []),
    ],
    iso
  );
}

/** 复活沉淀条目（不改历史：旧 `constraint-retired-<id>` 沉淀原样保留，复活原因单独成条） */
function saveReactivateKnowledge(
  sink: LifecycleKnowledgeSink,
  id: string,
  target: RetireTargetInfo,
  reason: string,
  iso: string
): { entryId: string; baseDir: string } {
  return saveLifecycleKnowledge(
    sink,
    `constraint-reactivated-${id}`,
    `约束复活：${id}`,
    [
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
    ],
    ['constraint-reactivated', `constraint:${id}`, `severity:${target.severity}`],
    iso
  );
}

/**
 * 执行单条约束退役（纯执行逻辑，无交互）
 *
 * 不存在的 id / 已退役的 id 通过 status 返回，由调用方提示。
 * 知识沉淀只在注入 `openKnowledgeStore` 时落盘（见模块头注入纪律）。
 */
export function retireConstraint(
  projectRoot: string,
  id: string,
  options: RetireExecuteOptions = {}
): RetireResult {
  const now = options.now ?? new Date();
  const iso = now.toISOString();
  const reason = options.reason ?? '';

  // 一次退役一份观察面（ADR-0023 决策 2）：定义查找与 already_retired 判定共用这一份装载结果。
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();

  const target = findRetireTarget(id, projectRoot);
  const emptyStats = { total: 0, fail: 0, failRate: 0 };
  if (!target) {
    return { id, status: 'unknown_id', isError: false, stats: emptyStats };
  }
  const isError = target.severity === 'error';

  // 已退役保护：只认 retired 墓碑（ADR-0032 决策 6.6，票 02 断点 6）——
  // 裸 enabled:false 是"禁用"不是"退休"，落到下面正常退休流程：覆写墓碑 + 补写沉淀，
  // 不让一次裸 disable 吞掉 retire 的知识沉淀。判定谓词唯一实现 = isRetiredTombstone。
  const existing = loadConstraintEntry(loader, id);
  if (isRetiredTombstone(existing)) {
    return { id, status: 'already_retired', isError, stats: emptyStats };
  }

  // 历史统计（来自 traces.log）
  // 计数去向：坏行计数随 readProjectTracesReport 可得，但落盘的 retire stats 只计
  // 合法记录，把坏行数写进 RetireResult.stats 属形状变更不在本票；本函数按契约「纯执行无交互」
  // 不打印，告知由两条命令入口各自负责（runRetireInteractive 顶部 / constraintsRetire 的 --yes 分支）
  const usage = collectUsageByConstraint(readProjectTracesReport(projectRoot).traces).get(id);
  const evaluated = usage ? usage.total - usage.skip : 0;
  const stats = {
    total: usage?.total ?? 0,
    fail: usage?.fail ?? 0,
    failRate: usage && evaluated > 0 ? usage.fail / evaluated : 0,
  };

  // 1. 落盘退役（config.yml enabled:false + retired 段，原文保留）。
  // 写前留内存备份（验证失败回滚用）；createBackup 请求时同建磁盘备份（观察期回滚凭据）
  const configPath = path.join(projectRoot, '.harness', 'config.yml');
  const beforeContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
  const backupPath = options.createBackup ? backupConfigFile(configPath, now) : null;

  const retiredMeta = { at: iso, reason, stats };
  // 写入 + 写后双验证同一失败恢复域（评审修复）：setYamlEntry 半写、YAML/生效集
  // 读取抛异常与验证返回 false 同罪——恢复写前内容、清掉磁盘备份，返回显式 verify_failed。
  // 知识沉淀刻意留在这个域之外：sink 的既有异常语义本票不改
  try {
    setYamlEntry(
      configPath,
      'config.yml',
      'constraints',
      id,
      { enabled: false, retired: retiredMeta }
    );

    // 写后双验证（下游配置公共化，无知识 sink 的库路径同样执行）：生效集已缩小 +
    // retired 墓碑在场
    if (!verifyRetired(projectRoot, id)) {
      throw new Error(`retire 写后验证失败：${id} 生效集未缩小或墓碑缺失`);
    }
  } catch {
    if (beforeContent !== null) fs.writeFileSync(configPath, beforeContent, 'utf-8');
    else fs.rmSync(configPath, { force: true });
    if (backupPath !== null) fs.rmSync(backupPath, { force: true });
    return { id, status: 'verify_failed', isError, stats };
  }

  // 3. 知识沉淀（注入 seam：缺省不写，见模块头）
  const knowledge = options.openKnowledgeStore
    ? saveRetireKnowledge(options.openKnowledgeStore(), id, target, reason, stats, iso)
    : undefined;

  const observation: ConfigObservation | undefined = options.createBackup
    ? {
        targetPath: configPath,
        backupPath,
        beforeHash: beforeContent === null ? null : hashConfigContent(beforeContent),
        afterHash: hashConfigContent(fs.readFileSync(configPath, 'utf-8')),
      }
    : undefined;

  return {
    id,
    status: 'retired',
    isError,
    stats,
    ...(knowledge ? { knowledgeEntryId: knowledge.entryId, knowledgeBaseDir: knowledge.baseDir } : {}),
    ...(observation ? { observation } : {}),
  };
}

/**
 * retire 写后双验证（下游配置公共化）：墓碑核验直读写后 config.yml（不复用写前
 * loader 的装载结果），生效集缩小走 `getEffectiveConstraints` 同一观察缝
 * （与 disable 写后验证同形）；两者都过才算成功
 */
function verifyRetired(projectRoot: string, id: string): boolean {
  const configPath = path.join(projectRoot, '.harness', 'config.yml');
  if (!fs.existsSync(configPath)) return false;
  const raw = (yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown> | null) ?? {};
  const entry = ((raw.constraints ?? {}) as Record<string, unknown>)[id] as { enabled?: boolean; retired?: unknown } | undefined;
  if (!isRetiredTombstone(entry)) return false;
  return !getEffectiveConstraints(projectRoot).some(c => c.id === id);
}

export interface ReactivateExecuteOptions {
  /** 复活原因（可空） */
  reason?: string;
  /** 注入当前时间（测试用） */
  now?: Date;
  /** 知识沉淀写口工厂（同 RetireExecuteOptions.openKnowledgeStore；缺省不写复活沉淀） */
  openKnowledgeStore?: () => LifecycleKnowledgeSink;
}

export type ReactivateStatus = 'reactivated' | 'not_retired' | 'unknown_id';

export interface ReactivateResult {
  id: string;
  status: ReactivateStatus;
  /** KnowledgeStore 条目 id（status='reactivated' 且注入了写口时存在） */
  knowledgeEntryId?: string;
  /** 复活记录实际落盘的知识库根（status='reactivated' 且注入了写口时存在） */
  knowledgeBaseDir?: string;
}

/**
 * 执行单条约束复活（纯执行逻辑，无交互）
 *
 * 复活 = 撤销退休：删 config.yml `constraints.<id>` 墓碑段（约束回生效集），
 * 注入写口时同时写 `constraint-reactivated-<id>` 新条目（不改历史）。
 * 不存在的 id / 无 retired 墓碑的 id 通过 status 返回，由调用方提示。
 */
export function reactivateConstraint(
  projectRoot: string,
  id: string,
  options: ReactivateExecuteOptions = {}
): ReactivateResult {
  const now = options.now ?? new Date();
  const iso = now.toISOString();

  const target = findRetireTarget(id, projectRoot);
  if (!target) {
    return { id, status: 'unknown_id' };
  }

  // 只认 retired 墓碑：裸 disable 与未配置一律 not_retired（与 retire 的幂等口径对偶，
  // 判定谓词唯一实现 = isRetiredTombstone）
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const existing = loadConstraintEntry(loader, id);
  if (!isRetiredTombstone(existing)) {
    return { id, status: 'not_retired' };
  }

  // 1. 删 config.yml constraints.<id> 墓碑段（恢复 = 回生效集）
  removeYamlEntry(path.join(projectRoot, '.harness', 'config.yml'), 'constraints', id);

  // 2. 知识沉淀（注入 seam：缺省不写，见模块头）
  if (!options.openKnowledgeStore) {
    return { id, status: 'reactivated' };
  }
  const { entryId: knowledgeEntryId, baseDir: knowledgeBaseDir } = saveReactivateKnowledge(
    options.openKnowledgeStore(),
    id,
    target,
    options.reason ?? '',
    iso
  );

  return { id, status: 'reactivated', knowledgeEntryId, knowledgeBaseDir };
}

export type DisableStatus =
  | 'disabled'
  | 'already_disabled'
  | 'already_retired'
  | 'unknown_id'
  | 'verify_failed';

export interface DisableExecuteOptions {
  /** 注入当前时间（用作观察期备份文件名时间戳） */
  now?: Date;
  /** 观察期备份（同 RetireExecuteOptions.createBackup，下游配置公共化） */
  createBackup?: boolean;
}

export interface DisableResult {
  id: string;
  status: DisableStatus;
  /** 观察期备份元数据（仅 `createBackup` 请求且 status='disabled' 时存在，下游配置公共化） */
  observation?: ConfigObservation;
}

/**
 * 执行单条约束裸禁用（纯执行逻辑，无交互）
 *
 * 裸禁用 = config.yml `constraints.<id>.enabled:false`，无 retired 墓碑、无知识沉淀
 * （墓碑与沉淀是 retire 专有语义）。写后验证生效集已缩小，失败回滚备份。
 * 不存在的 id / 已禁用 / 已退役的 id 通过 status 返回，由调用方提示。
 */
export function disableConstraint(
  projectRoot: string,
  id: string,
  options: DisableExecuteOptions = {}
): DisableResult {
  const target = findRetireTarget(id, projectRoot);
  if (!target) {
    return { id, status: 'unknown_id' };
  }

  // 幂等口径（ADR-0032 决策 6.6）：retired 墓碑优先判定——disable 不动墓碑不吞退休语义；
  // 裸 enabled:false 即已禁用。判定谓词唯一实现 = isRetiredTombstone
  const loader = new ProjectConfigLoader(projectRoot);
  loader.load();
  const existing = loadConstraintEntry(loader, id);
  if (isRetiredTombstone(existing)) {
    return { id, status: 'already_retired' };
  }
  if (existing?.enabled === false) {
    return { id, status: 'already_disabled' };
  }

  // 1. 落盘裸禁用（config.yml enabled:false，无 retired 段；同文件其他条目不动）。
  // 写前留内存备份（验证失败回滚用）；createBackup 请求时同建磁盘备份（观察期回滚凭据）
  const configPath = path.join(projectRoot, '.harness', 'config.yml');
  const backup = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
  const backupPath = options.createBackup ? backupConfigFile(configPath, options.now) : null;
  // 写入 + 写后验证同一失败恢复域（评审修复）：setYamlEntry 半写、生效集读取抛异常
  // 与验证判负同罪——恢复备份并清掉磁盘备份；与下游 applier 同一纪律
  try {
    setYamlEntry(configPath, 'config.yml', 'constraints', id, { enabled: false });
    if (getEffectiveConstraints(projectRoot).some(c => c.id === id)) {
      throw new Error('constraint still present in effective set after disable');
    }
  } catch {
    if (backup !== null) fs.writeFileSync(configPath, backup, 'utf-8');
    else fs.rmSync(configPath, { force: true });
    if (backupPath !== null) fs.rmSync(backupPath, { force: true });
    return { id, status: 'verify_failed' };
  }

  const observation: ConfigObservation | undefined = options.createBackup
    ? {
        targetPath: configPath,
        backupPath,
        beforeHash: backup === null ? null : hashConfigContent(backup),
        afterHash: hashConfigContent(fs.readFileSync(configPath, 'utf-8')),
      }
    : undefined;

  return { id, status: 'disabled', ...(observation ? { observation } : {}) };
}
