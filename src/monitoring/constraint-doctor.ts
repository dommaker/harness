/**
 * Agent 诊断接口
 *
 * 当检测到异常时，提供 Agent 分析 traces 的能力
 *
 * 成本控制：
 * - 仅在有异常时触发
 * - 精简 prompt，不喂全部 traces
 * - ~2000 Token/次
 */

import type {
  ExecutionTrace,
  TraceAnomaly,
  TraceSummary,
} from '../types/trace';
import type { Diagnosis } from '../types/monitoring-types';
import type { LLMAdapter } from '../llm/types';
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
  private summary: TraceSummary | null;
  private llm: LLMAdapter | null;

  constructor(config?: ConstraintDoctorConfig, llm?: LLMAdapter) {
    this.config = {
      enabled: false,
      maxTracesInPrompt: 20,
      autoGenerateProposal: false,
      ...config,
    };
    this.traces = [];
    this.summary = null;
    this.llm = llm || null;
  }

  /**
   * 设置诊断数据
   */
  setData(traces: ExecutionTrace[], summary?: TraceSummary): void {
    this.traces = traces;
    this.summary = summary || null;
  }

  /**
   * 诊断异常
 *
   * 如果 Agent 未启用，返回基于规则的诊断
   */
  async diagnose(anomaly: TraceAnomaly): Promise<Diagnosis> {
    // 过滤相关 traces
    const relevantTraces = this.filterRelevantTraces(anomaly);

    // 基于规则的初步诊断（不消耗 Token）
    const ruleBasedDiagnosis = this.ruleBasedDiagnose(anomaly, relevantTraces);

    // 如果 LLM 可用，进行深度分析
    if (this.config.enabled && this.llm) {
      try {
        return await this.agentDiagnose(anomaly, relevantTraces, ruleBasedDiagnosis);
      } catch {
        // LLM 调用失败，降级到规则诊断
        return ruleBasedDiagnosis;
      }
    }

    return ruleBasedDiagnosis;
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
   * LLM 深度诊断
   *
   * 将异常和相关 traces 构造为 prompt，调用 LLM 分析根因
   * 成本：~2000 Token/次
   */
  private async agentDiagnose(
    anomaly: TraceAnomaly,
    traces: ExecutionTrace[],
    fallback: Diagnosis
  ): Promise<Diagnosis> {
    const maxTraces = this.config.maxTracesInPrompt || 20;
    const traceSummary = traces.slice(0, maxTraces).map(t =>
      `[${t.result}] ${t.constraintId} | ${t.operation || 'unknown'} | ${t.timestamp ? new Date(t.timestamp).toISOString() : 'no-ts'}`
    ).join('\n');

    const prompt = `你是约束系统诊断专家。分析以下异常并给出诊断结果。

## 异常信息
- 约束 ID: ${anomaly.constraintId}
- 异常类型: ${anomaly.type}
- 约束层级: ${anomaly.level}
- 当前数据: ${JSON.stringify(anomaly.data)}

## 相关 Traces（最近 ${Math.min(traces.length, maxTraces)} 条）
${traceSummary || '无相关 traces'}

## 要求
以 JSON 格式返回诊断结果，包含以下字段：
{
  "rootCause": { "primary": "主要原因", "secondary": ["次要原因1", "次要原因2"] },
  "impact": { "severity": "low|medium|high", "scope": "single_project|multiple_projects|team", "userImpact": "用户影响描述" },
  "recommendations": [{ "type": "add_exception|adjust_threshold|modify_constraint|user_training", "content": "建议内容", "expectedOutcome": "预期效果", "implementationCost": "low|medium|high" }],
  "needsChange": true/false,
  "urgency": "low|medium|high"
}

只返回 JSON，不要其他内容。`;

    const response = await this.llm!.complete(prompt, {
      maxTokens: 1000,
      temperature: 0.3,
    });

    // 解析 LLM 响应
    const parsed = this.parseAgentResponse(response);

    return {
      ...fallback,
      rootCause: {
        primary: parsed.rootCause?.primary || fallback.rootCause.primary,
        secondary: parsed.rootCause?.secondary || fallback.rootCause.secondary,
        evidence: fallback.rootCause.evidence,
      },
      impact: {
        severity: parsed.impact?.severity || fallback.impact.severity,
        scope: parsed.impact?.scope || fallback.impact.scope,
        userImpact: parsed.impact?.userImpact || fallback.impact.userImpact,
      },
      recommendations: parsed.recommendations?.length ? parsed.recommendations : fallback.recommendations,
      needsChange: parsed.needsChange ?? fallback.needsChange,
      urgency: parsed.urgency || fallback.urgency,
    };
  }

  /**
   * 解析 LLM 返回的 JSON 诊断结果
   */
  private parseAgentResponse(response: string): Partial<Diagnosis> {
    try {
      // 提取 JSON（可能被 markdown 代码块包裹）
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return {};
      return JSON.parse(jsonMatch[0]);
    } catch {
      return {};
    }
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
export function createDoctor(config?: ConstraintDoctorConfig, llm?: LLMAdapter): ConstraintDoctor {
  return new ConstraintDoctor(config, llm);
}