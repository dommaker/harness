/**
 * Constraint Prompt Injection — 将 harness 约束的前置声明注入 Agent prompt
 *
 * Agent prompt 已有的 promptInjection 字段但从未被消费。
 * 此处将其按 agent role 路由，让 Agent 在行动前就知道约束。
 */

import { getAllConstraints } from './definitions';
import type { ConstraintTrigger } from '../../types/constraint';

export type AgentRole = 'analyst' | 'executor' | 'integration' | 'reviewer' | 'deploy' | 'monitor' | 'triage';

const ROLE_TRIGGERS: Record<AgentRole, ConstraintTrigger[]> = {
  analyst: ['design_request', 'api_change', 'code_implementation'],
  executor: ['code_implementation', 'task_completion_claim', 'test_creation', 'api_change', 'file_modification', 'module_modification', 'module_creation'],
  integration: ['code_implementation'],
  reviewer: ['code_implementation'],
  deploy: [],
  monitor: [],
  triage: [],
};

/**
 * Format all applicable constraints as a prompt injection section for a given agent role.
 * Uses the existing promptInjection field from each constraint definition.
 */
export function formatConstraintsForPrompt(role: AgentRole): string {
  const allConstraints = getAllConstraints();
  const triggers = ROLE_TRIGGERS[role] || [];
  if (triggers.length === 0) return '';

  const applicable = Object.values(allConstraints).filter(c => {
    const ct = c.trigger;
    if (Array.isArray(ct)) return ct.some(t => triggers.includes(t));
    return triggers.includes(ct);
  });

  if (applicable.length === 0) return '';

  const ironLaws = applicable.filter(c => c.level === 'iron_law');
  const guidelines = applicable.filter(c => c.level === 'guideline');
  const tips = applicable.filter(c => c.level === 'tip');

  const lines: string[] = ['\n## 行为约束（前置声明）\n'];

  if (ironLaws.length > 0) {
    lines.push('### 铁律（绝对禁止，无例外）\n');
    for (const c of ironLaws) {
      if (c.promptInjection) lines.push(`- **${c.id}**: ${c.promptInjection}`);
    }
    lines.push('');
  }

  if (guidelines.length > 0) {
    lines.push('### 指导原则（优先建议）\n');
    for (const c of guidelines) {
      if (c.promptInjection) lines.push(`- **${c.id}**: ${c.promptInjection}`);
    }
    lines.push('');
  }

  if (tips.length > 0) {
    lines.push('### 提示\n');
    for (const c of tips) {
      if (c.promptInjection) lines.push(`- **${c.id}**: ${c.promptInjection}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
