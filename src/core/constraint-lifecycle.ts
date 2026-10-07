/**
 * 约束变更面库函数（harness#198）：retire / reactivate / disable
 *
 * 三个执行函数自 cli 命令模块原样搬入 core 并上公共 barrel——签名（位置参数）与
 * 返回的状态联合类型逐字不变，CLI 命令改为调用本模块的薄壳。下游消费方
 * 不再直读直写 `.harness/config.yml`。
 *
 * 语义（与搬家前一致，详见各函数）：
 * - retire：永久退役——config.yml `enabled:false` + `retired` 墓碑 + 知识沉淀；
 *   裸 disabled 条目会被接管补墓碑+沉淀（ADR-0032 决策 6.6）
 * - reactivate：撤销退休——删墓碑段回生效集 + 写复活沉淀（不改历史，ADR-0032 决策 6.5）
 * - disable：裸禁用——`enabled:false` 无墓碑无沉淀；retired 墓碑不动
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
import { collectUsageByConstraint, readProjectTraces } from './constraints/usage-report';

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
  /** 注入当前时间（测试用） */
  now?: Date;
  /**
   * 知识沉淀写口工厂（harness#88 注入纪律）。注入 = 退休时写 `constraint-retired-<id>`
   * 沉淀（consumptionMode: 'signal'）；缺省 = 只落 config.yml 墓碑，不写沉淀
   */
  openKnowledgeStore?: () => LifecycleKnowledgeSink;
}

export type RetireStatus = 'retired' | 'already_retired' | 'unknown_id';

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
  // 计数去向：兼容包装 readProjectTraces() 丢计数（harness#100）——落盘的 retire stats 只计
  // 合法记录，把坏行数写进 RetireResult.stats 属形状变更不在本票；本函数按契约「纯执行无交互」
  // 不打印，告知由两条命令入口各自负责（runRetireInteractive 顶部 / constraintsRetire 的 --yes 分支）
  const usage = collectUsageByConstraint(readProjectTraces(projectRoot)).get(id);
  const evaluated = usage ? usage.total - usage.skip : 0;
  const stats = {
    total: usage?.total ?? 0,
    fail: usage?.fail ?? 0,
    failRate: usage && evaluated > 0 ? usage.fail / evaluated : 0,
  };

  // 1. 落盘退役（config.yml enabled:false + retired 段，原文保留）
  const retiredMeta = { at: iso, reason, stats };
  setYamlEntry(
    path.join(projectRoot, '.harness', 'config.yml'),
    'config.yml',
    'constraints',
    id,
    { enabled: false, retired: retiredMeta }
  );

  // 2. 知识沉淀（注入 seam：缺省不写，见模块头）
  if (!options.openKnowledgeStore) {
    return { id, status: 'retired', isError, stats };
  }
  const { entryId: knowledgeEntryId, baseDir: knowledgeBaseDir } = saveRetireKnowledge(
    options.openKnowledgeStore(),
    id,
    target,
    reason,
    stats,
    iso
  );

  return {
    id,
    status: 'retired',
    isError,
    stats,
    knowledgeEntryId,
    knowledgeBaseDir,
  };
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

export interface DisableResult {
  id: string;
  status: DisableStatus;
}

/**
 * 执行单条约束裸禁用（纯执行逻辑，无交互）
 *
 * 裸禁用 = config.yml `constraints.<id>.enabled:false`，无 retired 墓碑、无知识沉淀
 * （墓碑与沉淀是 retire 专有语义）。写后验证生效集已缩小，失败回滚备份。
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
  const existing = loadConstraintEntry(loader, id);
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
