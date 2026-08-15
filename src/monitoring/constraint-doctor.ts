/**
 * 约束诊断器
 *
 * 当检测到异常时，基于预设规则分析 traces 给出诊断（零 Token，不调用 LLM）。
 */

import type {
  ExecutionTrace,
  TraceAnomaly,
  TraceSummary,
} from '../types/trace';
import type { Diagnosis } from '../types/monitoring-types';
import { DIAGNOSIS_RULES } from './diagnosis-rules';

// 类型定义已归位 types 层（工单 14），此处再导出保持模块公开面不变
export type { Diagnosis };

/**
 * 诊断配置
 */
export interface ConstraintDoctorConfig {
  /** 是否启用 Agent 诊断（默认 false，需要显式启用） */
  enabled?: boolean;

  /** Agent 类型（预留，后续对接） */
  agentType?: 'claude-code' | 'codex' | 'openai';

  /** 最大 traces 数量（用于构造 prompt） */
  maxTracesInPrompt?: number;

  /** 是否自动生成提案 */
  autoGenerateProposal?: boolean;
}

/**
 * Constraint Doctor - 约束诊断器
 *
 * 使用方式：
 * ```typescript
 * const doctor = new ConstraintDoctor(analyzer);
 * const diagnosis = await doctor.diagnose(anomaly);
 *
 * if (diagnosis.needsChange) {
 *   const proposal = await evolver.propose(diagnosis);
 * }
 * ```
 */
export class ConstraintDoctor {
  private config: ConstraintDoctorConfig;
  private traces: ExecutionTrace[];

  constructor(config?: ConstraintDoctorConfig) {
    this.config = {
      enabled: false,
      maxTracesInPrompt: 20,
      autoGenerateProposal: false,
      ...config,
    };
    this.traces = [];
  }

  /**
   * 设置诊断数据
   */
  setData(traces: ExecutionTrace[], _summary?: TraceSummary): void {
    this.traces = traces;
  }

  /**
   * 诊断异常
 *
   * 如果 Agent 未启用，返回基于规则的诊断
   */
  async diagnose(anomaly: TraceAnomaly): Promise<Diagnosis> {
    // 过滤相关 traces
    const relevantTraces = this.filterRelevantTraces(anomaly);

    // 基于规则的诊断（不消耗 Token）
    return this.ruleBasedDiagnose(anomaly, relevantTraces);
  }

  /**
   * 基于规则的诊断（零 Token）
 *
   * 根据异常类型应用预设的诊断规则
   */
  private ruleBasedDiagnose(
    anomaly: TraceAnomaly,
    traces: ExecutionTrace[]
  ): Diagnosis {
    const diagnosis: Diagnosis = {
      anomalyId: `${anomaly.constraintId}-${anomaly.type}-${Date.now()}`,
      constraintId: anomaly.constraintId,
      diagnosedAt: Date.now(),
      rootCause: {
        primary: '',
        secondary: [],
        evidence: traces.slice(0, this.config.maxTracesInPrompt!),
      },
      impact: {
        severity: 'medium',
        scope: 'single_project',
        userImpact: '',
      },
      recommendations: [],
      needsChange: false,
      urgency: 'low',
    };

    // 根据异常类型诊断（工单 23-B：规则数据化，见 diagnosis-rules.ts）
    const rule = DIAGNOSIS_RULES[anomaly.type];
    if (rule) {
      diagnosis.rootCause.primary = rule.primary;
      diagnosis.rootCause.secondary = rule.secondary;
      diagnosis.impact.userImpact = rule.userImpact;
      diagnosis.recommendations = rule.recommendations(anomaly);
      diagnosis.needsChange = rule.needsChange;
      diagnosis.urgency = rule.urgency(anomaly);
    }

    // 根据约束层级调整严重性
    if (anomaly.level === 'iron_law') {
      diagnosis.impact.severity = 'high';
      diagnosis.urgency = 'medium'; // Iron law 总是至少 medium
    }

    return diagnosis;
  }

  /**
   * 过滤相关 traces
   *
   * 只保留与异常相关的 traces，减少 prompt 内容
   */
  private filterRelevantTraces(anomaly: TraceAnomaly): ExecutionTrace[] {
    return this.traces.filter(t => {
      // 必须是同一个约束
      if (t.constraintId !== anomaly.constraintId) return false;

      // 失败或绕过的更有诊断价值
      if (t.result === 'fail' || t.result === 'bypassed') return true;

      // 保留少量通过的作为对比
      return true;
    });
  }

  /**
   * 批量诊断多个异常
   */
  async diagnoseBatch(anomalies: TraceAnomaly[]): Promise<Diagnosis[]> {
    return Promise.all(anomalies.map(a => this.diagnose(a)));
  }

  /**
   * 生成诊断报告（文本格式）
   */
  generateReport(diagnosis: Diagnosis): string {
    const lines: string[] = [];

    lines.push(`# Diagnosis Report`);
    lines.push(`Constraint: ${diagnosis.constraintId}`);
    lines.push(`Anomaly: ${diagnosis.anomalyId}`);
    lines.push(`Diagnosed: ${new Date(diagnosis.diagnosedAt).toISOString()}`);
    lines.push('');

    // 根因
    lines.push(`## Root Cause`);
    lines.push('');
    lines.push(`**Primary**: ${diagnosis.rootCause.primary}`);
    if (diagnosis.rootCause.secondary?.length) {
      lines.push('');
      lines.push('**Secondary**:');
      for (const s of diagnosis.rootCause.secondary) {
        lines.push(`- ${s}`);
      }
    }
    lines.push('');

    // 影响
    lines.push(`## Impact`);
    lines.push('');
    lines.push(`- Severity: ${diagnosis.impact.severity}`);
    lines.push(`- Scope: ${diagnosis.impact.scope}`);
    lines.push(`- User Impact: ${diagnosis.impact.userImpact}`);
    lines.push('');

    // 建议
    lines.push(`## Recommendations`);
    lines.push('');

    for (const r of diagnosis.recommendations) {
      lines.push(`### ${r.type}`);
      lines.push(`- Content: ${r.content}`);
      lines.push(`- Expected: ${r.expectedOutcome}`);
      lines.push(`- Cost: ${r.implementationCost}`);
      lines.push('');
    }

    // 决策
    lines.push(`## Decision`);
    lines.push('');
    lines.push(`- Needs Change: ${diagnosis.needsChange ? '✅ Yes' : '❌ No'}`);
    lines.push(`- Urgency: ${diagnosis.urgency}`);

    return lines.join('\n');
  }

  /**
   * 保存诊断结果
   */
  saveDiagnosis(diagnosis: Diagnosis, outputPath: string): void {
    const fs = require('fs');
    const path = require('path');

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(diagnosis, null, 2), 'utf-8');
  }

  /**
   * 加载诊断结果
   */
  loadDiagnosis(inputPath: string): Diagnosis {
    const fs = require('fs');
    const content = fs.readFileSync(inputPath, 'utf-8');
    return JSON.parse(content) as Diagnosis;
  }
}

/**
 * 创建诊断器
 */
export function createDoctor(config?: ConstraintDoctorConfig): ConstraintDoctor {
  return new ConstraintDoctor(config);
}