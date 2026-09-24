/**
 * 约束检查器接缝类型（工单 21）
 *
 * checker.ts 的 per-constraint 实现拆分到 checkers/ 目录，
 * 通过 ConstraintCheck 接口 + CheckEnv 环境与编排层解耦。
 */

import type { ConstraintContext } from '../../../types/constraint';
import { createRunEnv, type RunEnv } from '../run-env';

/**
 * 检查环境：一次 run 内共享的观察面与证据提供者（ADR-0023 决策 1）
 *
 * = `RunEnv`（项目上行数据的读取：config.yml / trace 尾部 / 源根，run 内至多一次）
 *   + `context` + git/扫描证据。前者不含 context，故只能派生不能合并成一个对象。
 *
 * - stagedDiff/stagedDiffNames：run 内 git 命令至多一次（工单 18 / #87）
 * - srcScan：run 内同根源码扫描至多一次（CheckCache）
 */
export interface CheckEnv extends RunEnv {
  /** 约束上下文（operation/changedFiles/各类证据标志） */
  context: ConstraintContext;
  /** staged 全量 diff（run 内 memoized） */
  stagedDiff(): Promise<string>;
  /** staged 变更文件名列表（run 内 memoized） */
  stagedDiffNames(): Promise<string>;
  /** 源码根相对路径文件列表（run 内 cached） */
  srcScan(root: string): string[];
  /**
   * 证据输入是否可得（harness#182 输入契约）
   *
   * 编排层按 ConstraintCheck.needs 比对，不可得即显式降级 skip，不再让 checker
   * 对空证据做出「假合规」判定。buildCheckEnv 恒填充；手写 env 省略 = 全部可得
   * （旧形状兼容，编排层按 available 处理）。
   */
  evidenceAvailable?(input: CheckEvidenceInput): boolean;
}

/**
 * 证据提供者组：git diff / 源码扫描的 memoized I/O
 *
 * 由调用方绑定后传入 buildCheckEnv（#87：git 两项绑 GitEvidence adapter 实例，
 * 一次 run 一份，命令级 memo 在 adapter 层）；工厂本身不做 memoization。
 */
export interface EvidenceProviders {
  /** staged 全量 diff */
  stagedDiff(): Promise<string>;
  /** staged 变更文件名列表 */
  stagedDiffNames(): Promise<string>;
  /** 源码根相对路径文件列表 */
  srcScan(root: string): string[];
  /** 证据输入是否可得（harness#182）；省略 = 全部可得 */
  available?(input: CheckEvidenceInput): boolean;
}

/** git 证据输入种类（harness#182 输入契约的比对单元） */
export type CheckEvidenceInput = 'stagedDiff' | 'stagedDiffNames';

/**
 * 构造 CheckEnv：生产侧唯一构造点
 *
 * - providers 传入 = 证据接线，checker 正常评估
 * - 'none' = 显式不接证据：证据函数返回空；evidence flag 未接线的
 *   checker 按契约返回 'skip'（见 contextEvidenceFlag），直接读空
 *   证据的 checker 在自然输入下判定
 * - runEnv = 本 run 的运行级观察面（ADR-0023）：传入即与 context-builder 及
 *   其余 checker 共用同一份上行数据读取；不传则自造一枚，只服务本次调用
 *
 * studio 侧若需 git 证据（#129），传真实 providers 即可。
 */
export function buildCheckEnv(
  context: ConstraintContext,
  evidence: EvidenceProviders | 'none',
  runEnv?: RunEnv
): CheckEnv {
  const projectPath = context.projectPath || process.cwd();
  const run = runEnv ?? createRunEnv(projectPath);
  if (evidence === 'none') {
    return {
      ...run,
      context,
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      srcScan: () => [],
      evidenceAvailable: () => false,
    };
  }
  const { available, ...providers } = evidence;
  return { ...run, context, ...providers, evidenceAvailable: available ?? (() => true) };
}

/**
 * 带原因的跳过（harness#182）
 *
 * 「检查器失效 / 输入不可得 / 约定未采用」≠「对象合规」：未评估必须显式、有声、
 * 可统计。reason 自描述（可直接给人看），经 NormalizedOutcome.skipReason 落到
 * ConstraintResult、CLI 跳过清单与 trace；编排层只透传，不参与解释内容。
 */
export interface CheckSkip {
  skip: true;
  /** 未评估原因（如「staged diff 不可得（git 取证失败）」） */
  reason: string;
}

/**
 * 检查结果三态（ADR-0001 存在性探测 / flag 未接线）：
 * - true = 满足（pass）
 * - false = 违反（fail）
 * - 'skip' = 未评估（等价 CheckSkip 的无原因旧形状），不计 pass/fail
 * - CheckSkip = 未评估 + 原因（harness#182，进结果面与 trace）
 * - CheckDetail = 判定 + 证据行（harness#119）
 */
export type CheckOutcome = boolean | 'skip' | CheckSkip | CheckDetail;

/**
 * 带证据的检查结果（harness#119）
 *
 * 动机：只回布尔时，fail 的具体原因（哪个文件没登记）在 CLI 与 trace 两头都落脚不了，
 * 一条恒红的约束无法被诊断。证据行由 checker 自行措辞（自描述、可直接给人看），
 * 编排层只负责透传与打印，不参与解释内容。
 *
 * `pass: true` + 非空 evidence = 「满足但有提示」：不进 pass/fail 统计口径，
 * 仅作为可观测输出（如仓库级文档漂移——与本次变更无因果，不该判违规）。
 */
export interface CheckDetail {
  /** false = 违反；true = 满足 */
  pass: boolean;
  /** 证据行（每条自描述，如「变更文件未登记: src/foo.ts」） */
  evidence?: string[];
}

/** 归一后的检查结果：编排层 / gate 唯一消费形状 */
export interface NormalizedOutcome {
  satisfied: boolean;
  skipped: boolean;
  evidence: string[];
  /** 未评估原因（harness#182；仅 skipped=true 时可能携带，进 CLI 跳过清单与 trace） */
  skipReason?: string;
}

/** 证据条数上限：trace 是 JSONL，缺口上百项时不能整仓落盘 */
export const MAX_EVIDENCE_ITEMS = 10;

/**
 * 组装证据行：一行说明 + 逐条依据（超限截断）
 *
 * 每行自描述且不带缩进——缩进由消费端（CLI / gate 理由 / error 级异常文案）决定，trace 原样存。
 * 修复入口不写在这里：那是各约束自己的事，写进各自的 summary 行（docs_freshness 的
 * 幽灵条目与 sync-docs 无关，共用一个指针会误导）。
 */
export function formatEvidence(summary: string, items: string[]): string[] {
  const shown = items.slice(0, MAX_EVIDENCE_ITEMS);
  const hidden = items.length - shown.length;
  return [...(summary ? [summary] : []), ...shown, ...(hidden > 0 ? [`…另 ${hidden} 项`] : [])];
}

/**
 * 归一 CheckOutcome（boolean | 'skip' | CheckDetail）为统一形状
 *
 * skip 恒不携带证据：未评估的约束不得留下证据行（否则统计侧会把「没查」读成「查出问题」）。
 */
export function normalizeCheckOutcome(outcome: CheckOutcome): NormalizedOutcome {
  if (outcome === 'skip') return { satisfied: true, skipped: true, evidence: [] };
  if (typeof outcome === 'boolean') return { satisfied: outcome, skipped: false, evidence: [] };
  if ('skip' in outcome) {
    return { satisfied: true, skipped: true, evidence: [], skipReason: outcome.reason };
  }
  return {
    satisfied: outcome.pass,
    skipped: false,
    evidence: outcome.evidence ?? [],
  };
}

/**
 * 检查器声明式输入契约（harness#182）
 *
 * checker 声明自己吃什么输入；编排层在 evaluate 前比对环境实际供给，
 * 缺输入即统一显式降级（带原因的 skipped），代替各 checker 自行静默退化
 * （如对空 diff 假 pass、对 undefined flag 无声 skip）。
 */
export interface CheckInputNeeds {
  /** git 证据输入：env.evidenceAvailable 报不可得 → 降级 skip */
  evidence?: CheckEvidenceInput[];
  /** 上下文证据标志：值为 undefined（未接线）→ 降级 skip */
  contextFlags?: ContextEvidenceFlag[];
}

/** ConstraintContext 中取值为 boolean | undefined 的证据标志名 */
export type ContextEvidenceFlag = {
  [K in keyof ConstraintContext]-?: ConstraintContext[K] extends boolean | undefined ? K : never;
}[keyof ConstraintContext];

/** 证据标志未接线的 skip 原因文案（findMissingInputs 与 contextEvidenceFlag 兜底共用） */
function flagNotWiredReason(flag: string): string {
  return `证据标志 ${flag} 未接线`;
}

/**
 * 输入契约比对：返回缺项描述（空数组 = 输入齐备，可进入评估）
 *
 * 每条缺项自描述（直接进 skip reason）；手写 env 未提供 evidenceAvailable
 * 时按「全部可得」处理（旧形状兼容）。
 */
export function findMissingInputs(check: ConstraintCheck, env: CheckEnv): string[] {
  const missing: string[] = [];
  for (const input of check.needs?.evidence ?? []) {
    const available = env.evidenceAvailable?.(input) ?? true;
    if (!available) {
      missing.push(
        input === 'stagedDiff'
          ? 'staged diff 不可得（git 取证失败或未接线）'
          : 'staged 变更文件清单不可得（git 取证失败或未接线）'
      );
    }
  }
  for (const flag of check.needs?.contextFlags ?? []) {
    if (env.context[flag] === undefined) missing.push(flagNotWiredReason(flag));
  }
  return missing;
}

/**
 * 输入契约降级（harness#182）：缺输入 → 带原因的 CheckSkip；齐备 → null
 *
 * 编排层（checker.ts）与 checker-as-guard 接线点（gates/checker-gate.ts）的
 * 唯一降级口，两处不得各写一遍比对 + 组装。
 */
export function degradeForMissingInputs(check: ConstraintCheck, env: CheckEnv): CheckSkip | null {
  const missing = findMissingInputs(check, env);
  return missing.length > 0 ? { skip: true, reason: missing.join('；') } : null;
}

/**
 * 单条约束检查实现
 */
export interface ConstraintCheck {
  /** 约束 ID（与 definitions 一致） */
  id: string;
  /** 输入契约（harness#182）：声明即由编排层保证，缺输入不进入 evaluate */
  needs?: CheckInputNeeds;
  /** 检查主体：true = 满足；false = 违反；'skip'/CheckSkip = 未评估；CheckDetail = 判定 + 证据行 */
  evaluate(env: CheckEnv): Promise<CheckOutcome> | CheckOutcome;
}

/**
 * 填空式 checker 模板工厂（ADR-0033 两层约束模型）
 *
 * 每个模板 = validateParams + create：参数坏在加载期早报（validateParams），
 * create 只在参数已校验后调用。注册点 = checkers/index.ts 的 TEMPLATES。
 * 类型住在 types.ts（而非 index.ts）是为了模板实现文件只依赖本模块，
 * 不与注册表形成值级循环导入。
 */
export interface TemplatedCheckerFactory {
  /** 参数校验：返回错误清单，空数组 = 通过（加载期跑，参数坏早报） */
  validateParams(params: Record<string, unknown>): string[];
  /** 按约束 id + 已校验参数实例化 checker */
  create(id: string, params: Record<string, unknown>): ConstraintCheck;
}

/**
 * 构造纯上下文标志检查（无 I/O 的轻量约束）
 */
export function contextFlag(
  id: string,
  predicate: (context: ConstraintContext) => boolean
): ConstraintCheck {
  return { id, evaluate: (env) => predicate(env.context) };
}

/**
 * 构造证据标志检查（ADR-0001：flag 未接线 = skip 而非 fail；harness#182 起 skip 带原因）
 *
 * - flag === undefined：调用方未接线该证据 → 编排层按 needs 契约降级 skip；
 *   直接 evaluate（绕过编排层）时此处兜底，同样报带原因的 skip
 * - flag === false：显式无证据 → fail
 * - flag === true：有证据 → pass
 */
export function contextEvidenceFlag(
  id: string,
  flag: ContextEvidenceFlag
): ConstraintCheck {
  return {
    id,
    needs: { contextFlags: [flag] },
    evaluate: (env) => {
      const value = env.context[flag];
      if (value === undefined) return { skip: true, reason: flagNotWiredReason(flag) };
      return value;
    },
  };
}
