/**
 * 诊断规则表（工单 23-B）
 *
 * constraint-doctor.ruleBasedDiagnose 的巨型 switch 数据化：
 * 每种异常类型一条规则（根因/影响/建议/紧急度），新增异常类型只需加表项。
 */

import type { TraceAnomaly } from '../types/trace';
import type { Diagnosis } from '../types/monitoring-types';

export interface DiagnosisRule {
  primary: string;
  secondary: string[];
  userImpact: string;
  recommendations: (anomaly: TraceAnomaly) => Diagnosis['recommendations'];
  needsChange: boolean;
  urgency: (anomaly: TraceAnomaly) => Diagnosis['urgency'];
}

export const DIAGNOSIS_RULES: Record<string, DiagnosisRule> = {
  high_bypass_rate: {
    primary: '约束过于严格，用户频繁绕过',
    secondary: [
      '约束触发条件过于宽泛',
      '缺乏必要的例外条件',
      '约束定义与实际场景不匹配',
    ],
    userImpact: '用户被迫绕过约束，降低信任度',
    recommendations: (anomaly) => [
      {
        type: 'add_exception',
        content: `为约束 ${anomaly.constraintId} 添加常见例外条件`,
        expectedOutcome: '绕过率降低至 20% 以下',
        implementationCost: 'low',
      },
      {
        type: 'adjust_threshold',
        content: '调整触发条件，减少误触发',
        expectedOutcome: '减少不必要的约束检查',
        implementationCost: 'medium',
      },
    ],
    needsChange: true,
    urgency: (anomaly) => ((anomaly.data.currentRate as number) > 0.5 ? 'high' : 'medium'),
  },

  rising_fail_rate: {
    primary: '约束失败率呈上升趋势',
    secondary: [
      '代码质量下降',
      '约束检查逻辑存在 bug',
      '环境变化导致约束不再适用',
    ],
    userImpact: '开发效率下降，约束频繁阻止正常操作',
    recommendations: () => [
      {
        type: 'modify_constraint',
        content: '审查约束逻辑，确认是否符合预期',
        expectedOutcome: '恢复正常的失败率水平',
        implementationCost: 'medium',
      },
      {
        type: 'user_training',
        content: '指导用户正确理解约束要求',
        expectedOutcome: '减少因误解导致的失败',
        implementationCost: 'low',
      },
    ],
    needsChange: true,
    urgency: () => 'medium',
  },

  rising_bypass_rate: {
    primary: '绕过率呈上升趋势',
    secondary: [
      '用户对约束的接受度下降',
      '约束规则逐渐不适应新的开发模式',
      '用户发现了绕过约束的"捷径"',
    ],
    userImpact: '约束逐渐失去约束力',
    recommendations: () => [
      {
        type: 'modify_constraint',
        content: '重新评估约束的必要性',
        expectedOutcome: '恢复约束的权威性',
        implementationCost: 'high',
      },
    ],
    needsChange: true,
    urgency: () => 'high',
  },

  low_pass_rate: {
    primary: '约束通过率过低',
    secondary: [
      '约束要求过于严格',
      '实际代码质量不达标',
      '约束定义存在歧义',
    ],
    userImpact: '几乎所有操作都被阻止，开发受阻',
    recommendations: () => [
      {
        type: 'adjust_threshold',
        content: '放宽约束要求，设置合理阈值',
        expectedOutcome: '通过率提升至 50% 以上',
        implementationCost: 'low',
      },
    ],
    needsChange: true,
    urgency: () => 'high',
  },

  exception_overuse: {
    primary: '例外条件被过度使用',
    secondary: [
      '例外条件过于宽泛',
      '例外条件定义不够精确',
      '用户习惯性申请例外',
    ],
    userImpact: '例外成为常态，约束失去意义',
    recommendations: () => [
      {
        type: 'modify_constraint',
        content: '缩小例外条件范围，提高例外门槛',
        expectedOutcome: '例外使用率降低至 20% 以下',
        implementationCost: 'medium',
      },
    ],
    needsChange: true,
    urgency: () => 'medium',
  },
};
