/**
 * Agent prompt 约束段渲染（H6/G6：trigger 参数化分组渲染 API）
 *
 * 收编 studio prompt-injection.ts 的渲染层：role→trigger 路由留在 studio，
 * 本模块只做 trigger 参数化 + 生效集过滤 + 层级分组渲染。
 *
 * 数据源 = getEffectiveConstraints（内置 → preset → config.yml 禁用 →
 * custom 追加 → scenes 过滤），与 init 注入、harness check 同一来源。
 *
 * 输出按层级分组：铁律 → 指导原则 → 行为提示；无 promptInjection 的约束
 * （如 docs_freshness）不渲染。
 */

import type { Constraint, ConstraintLevel, ConstraintTrigger } from '../../types/constraint';
import { normalizeTriggers } from '../../utils/exec';
import { getEffectiveConstraints } from '../effective-constraints';

/**
 * renderConstraintsByTrigger 选项
 */
export interface RenderConstraintsByTriggerOptions {
  /** 项目根路径（决定 config.yml 生效集），缺省 process.cwd() */
  projectRoot?: string;
}

/** 层级分组定义（渲染顺序即声明顺序） */
const LEVEL_GROUPS: ReadonlyArray<{ level: ConstraintLevel; heading: string }> = [
  { level: 'iron_law', heading: '### 铁律（绝对禁止，无例外）' },
  { level: 'guideline', heading: '### 指导原则（优先建议）' },
  { level: 'prompt', heading: '### 行为提示' },
];

/**
 * 按触发条件渲染约束分组文本（注入 Agent system prompt 用）
 *
 * 过滤：生效集内 trigger 与入参存在交集的约束；无 promptInjection 的不渲染。
 * 分组：按层级 iron_law → guideline → prompt 顺序渲染为标题 + 条目列表；
 * 无适用约束时返回空字符串。
 *
 * @param triggers 触发条件（单个或多个；空数组返回空字符串）
 * @param options.projectRoot 项目根路径（决定 config.yml 生效集）
 */
export function renderConstraintsByTrigger(
  triggers: ConstraintTrigger | ConstraintTrigger[],
  options?: RenderConstraintsByTriggerOptions,
): string {
  const requested = Array.isArray(triggers) ? triggers : [triggers];
  if (requested.length === 0) return '';

  const constraints = getEffectiveConstraints(options?.projectRoot);
  const applicable = constraints.filter(
    c => c.promptInjection && matchesTrigger(c, requested)
  );
  if (applicable.length === 0) return '';

  const lines: string[] = ['\n## 行为约束（前置声明）\n'];
  for (const group of LEVEL_GROUPS) {
    const items = applicable.filter(c => c.level === group.level);
    if (items.length === 0) continue;
    lines.push(`${group.heading}\n`);
    for (const c of items) {
      lines.push(`- **${c.id}**: ${c.promptInjection}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function matchesTrigger(constraint: Constraint, requested: ConstraintTrigger[]): boolean {
  return normalizeTriggers<ConstraintTrigger>(constraint.trigger).some(t => requested.includes(t));
}
