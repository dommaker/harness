/**
 * CLAUDE.md 约束注入段渲染（ADR-0001）
 *
 * 纯函数：输入生效约束集 + harness 版本，输出标记区间的期望文本。
 * 与写文件分离——init 注入与 P6 注入漂移校验（期望 vs 实际）共用此渲染。
 */

import type { Constraint } from '../../types/constraint';

/** 约束注入段开始标记 */
export const CONSTRAINTS_START_MARKER = '<!-- HARNESS_CONSTRAINTS_START -->';
/** 约束注入段结束标记 */
export const CONSTRAINTS_END_MARKER = '<!-- HARNESS_CONSTRAINTS_END -->';

/**
 * 渲染 CLAUDE.md 约束注入段（含 START/END 标记，不含 `## Governance Rules` 标题）
 *
 * 结构：### Iron Laws / ### Guidelines / ### Prompts（行为约束），
 * 条目为 `- **id**: promptInjection`；无 promptInjection 的 check 条目
 * （如 docs_freshness）不出现在注入段。返回文本以换行结尾。
 *
 * @param constraints 生效约束集（getEffectiveConstraints 的输出）
 * @param version harness 版本号（写入 `<!-- version: x -->` 供漂移校验）
 */
export function renderConstraintsSection(constraints: Constraint[], version: string): string {
  const lines: string[] = [CONSTRAINTS_START_MARKER, `<!-- version: ${version} -->`];

  const renderGroup = (level: 'iron_law' | 'guideline' | 'prompt', heading: string, first: boolean) => {
    const items = constraints.filter(c => c.level === level && c.promptInjection);
    if (items.length === 0) return;
    if (!first) lines.push('');
    lines.push(heading);
    for (const c of items) {
      lines.push(`- **${c.id}**: ${c.promptInjection}`);
    }
  };

  renderGroup('iron_law', '### Iron Laws (违反将阻断)', true);
  renderGroup('guideline', '### Guidelines (应遵循)', lines.length === 2);
  renderGroup('prompt', '### Prompts (行为约束)', lines.length === 2);

  lines.push(CONSTRAINTS_END_MARKER);
  return lines.join('\n') + '\n';
}
