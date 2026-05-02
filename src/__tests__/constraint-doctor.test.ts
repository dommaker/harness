/**
 * ConstraintDoctor 测试
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { ConstraintDoctor } from '../monitoring/constraint-doctor';
import type { TraceAnomaly } from '../types/trace';
import type { LLMAdapter, Message, LLMOptions, SummarizeConfig } from '../llm/types';
import * as fs from 'fs';
import * as path from 'path';

function createMockLLM(response: string): LLMAdapter & { complete: jest.Mock } {
  const mock = {
    complete: jest.fn<(prompt: string, options?: LLMOptions) => Promise<string>>().mockResolvedValue(response),
    chat: jest.fn<(messages: Message[], options?: LLMOptions) => Promise<string>>().mockResolvedValue(''),
    streamChat: jest.fn(),
    summarize: jest.fn(),
    extract: jest.fn(),
  };
  return mock as unknown as LLMAdapter & { complete: jest.Mock };
}

describe('ConstraintDoctor', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-doctor');
  let doctor: ConstraintDoctor;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    doctor = new ConstraintDoctor();
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('constructor', () => {
    it('应该创建实例', () => {
      expect(doctor).toBeDefined();
    });
  });

  describe('setData', () => {
    it('应该设置数据', () => {
      doctor.setData([], undefined);

      expect(doctor).toBeDefined();
    });
  });

  describe('diagnose', () => {
    it('应该诊断异常', async () => {
      const anomaly: TraceAnomaly = {
        type: 'high_bypass_rate',
        constraintId: 'no_fix_without_root_cause',
        level: 'guideline',
        message: '绕过率过高',
        data: {
          currentRate: 0.5,
          threshold: 0.3,
        },
        detectedAt: Date.now(),
      };

      const diagnosis = await doctor.diagnose(anomaly);

      expect(diagnosis).toBeDefined();
      expect(diagnosis.constraintId).toBe('no_fix_without_root_cause');
    });

    it('应该返回诊断结果', async () => {
      const anomaly: TraceAnomaly = {
        type: 'rising_fail_rate',
        constraintId: 'no_self_approval',
        level: 'iron_law',
        message: '失败率上升',
        data: {
          currentRate: 0.6,
          threshold: 0.5,
          trend: 'rising',
        },
        detectedAt: Date.now(),
      };

      const diagnosis = await doctor.diagnose(anomaly);

      expect(diagnosis.rootCause).toBeDefined();
      expect(diagnosis.impact).toBeDefined();
      expect(diagnosis.needsChange).toBeDefined();
    });
  });

  describe('generateReport', () => {
    it('应该生成报告', () => {
      const diagnosis = {
        anomalyId: 'test',
        constraintId: 'test',
        diagnosedAt: Date.now(),
        rootCause: { primary: 'Test', evidence: [] },
        impact: { severity: 'medium' as const, scope: 'single_project' as const, userImpact: 'Test' },
        recommendations: [],
        needsChange: true,
        urgency: 'medium' as const,
      };

      const report = doctor.generateReport(diagnosis);

      expect(typeof report).toBe('string');
      expect(report.length).toBeGreaterThan(0);
    });
  });

  describe('saveDiagnosis', () => {
    it('应该保存诊断', () => {
      const diagnosis = {
        anomalyId: 'test',
        constraintId: 'test',
        diagnosedAt: Date.now(),
        rootCause: { primary: 'Test', evidence: [] },
        impact: { severity: 'medium' as const, scope: 'single_project' as const, userImpact: 'Test' },
        recommendations: [],
        needsChange: false,
        urgency: 'low' as const,
      };

      const outputPath = path.join(tempDir, 'diagnosis.json');

      doctor.saveDiagnosis(diagnosis, outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
    });
  });

  describe('loadDiagnosis', () => {
    it('应该加载诊断', () => {
      const diagnosis = {
        anomalyId: 'test-load',
        constraintId: 'test-load',
        diagnosedAt: Date.now(),
        rootCause: { primary: 'Test', evidence: [] },
        impact: { severity: 'low' as const, scope: 'single_project' as const, userImpact: 'Test' },
        recommendations: [],
        needsChange: false,
        urgency: 'low' as const,
      };

      const outputPath = path.join(tempDir, 'diagnosis-load.json');
      doctor.saveDiagnosis(diagnosis, outputPath);

      const loaded = doctor.loadDiagnosis(outputPath);

      expect(loaded).toBeDefined();
      expect(loaded.anomalyId).toBe('test-load');
    });
  });

  describe('diagnose - 更多异常类型', () => {
    it('应该诊断 rising_bypass_rate', async () => {
      const anomaly: TraceAnomaly = {
        type: 'rising_bypass_rate',
        constraintId: 'no_fix_without_root_cause',
        level: 'guideline',
        message: '绕过率上升',
        data: { currentRate: 0.4, threshold: 0.2, trend: 'rising' },
        detectedAt: Date.now(),
      };

      const diagnosis = await doctor.diagnose(anomaly);

      expect(diagnosis.rootCause.primary).toContain('绕过率');
      expect(diagnosis.needsChange).toBe(true);
      expect(diagnosis.urgency).toBe('high');
    });

    it('应该诊断 low_pass_rate', async () => {
      const anomaly: TraceAnomaly = {
        type: 'low_pass_rate',
        constraintId: 'no_any_type',
        level: 'guideline',
        message: '通过率过低',
        data: { currentRate: 0.1, threshold: 0.5 },
        detectedAt: Date.now(),
      };

      const diagnosis = await doctor.diagnose(anomaly);

      expect(diagnosis.rootCause.primary).toContain('通过率');
      expect(diagnosis.needsChange).toBe(true);
      expect(diagnosis.urgency).toBe('high');
    });

    it('应该诊断 exception_overuse', async () => {
      const anomaly: TraceAnomaly = {
        type: 'exception_overuse',
        constraintId: 'no_fix_without_root_cause',
        level: 'guideline',
        message: '例外过度使用',
        data: { currentRate: 0.6, threshold: 0.2 },
        detectedAt: Date.now(),
      };

      const diagnosis = await doctor.diagnose(anomaly);

      expect(diagnosis.rootCause.primary).toContain('例外');
      expect(diagnosis.needsChange).toBe(true);
    });

    it('rising_fail_rate 应该设置 severity 为 high 当 iron_law', async () => {
      const anomaly: TraceAnomaly = {
        type: 'rising_fail_rate',
        constraintId: 'no_self_approval',
        level: 'iron_law',
        message: '失败率上升',
        data: { currentRate: 0.7, threshold: 0.3, trend: 'rising' },
        detectedAt: Date.now(),
      };

      const diagnosis = await doctor.diagnose(anomaly);

      expect(diagnosis.impact.severity).toBe('high');
    });
  });

  describe('diagnoseBatch', () => {
    it('应该批量诊断多个异常', async () => {
      const anomalies: TraceAnomaly[] = [
        {
          type: 'high_bypass_rate',
          constraintId: 'no_fix_without_root_cause',
          level: 'guideline',
          message: '绕过率过高',
          data: { currentRate: 0.5, threshold: 0.3 },
          detectedAt: Date.now(),
        },
        {
          type: 'low_pass_rate',
          constraintId: 'no_any_type',
          level: 'guideline',
          message: '通过率过低',
          data: { currentRate: 0.1, threshold: 0.5 },
          detectedAt: Date.now(),
        },
      ];

      const results = await doctor.diagnoseBatch(anomalies);

      expect(results.length).toBe(2);
      expect(results[0].constraintId).toBe('no_fix_without_root_cause');
      expect(results[1].constraintId).toBe('no_any_type');
    });
  });

  describe('saveDiagnosis - 目录不存在', () => {
    it('应该自动创建目录', () => {
      const nestedPath = path.join(tempDir, 'nested', 'deep', 'diagnosis.json');
      const diagnosis = {
        anomalyId: 'nested-test',
        constraintId: 'test',
        diagnosedAt: Date.now(),
        rootCause: { primary: 'Test', evidence: [] },
        impact: { severity: 'low' as const, scope: 'single_project' as const, userImpact: 'Test' },
        recommendations: [],
        needsChange: false,
        urgency: 'low' as const,
      };

      doctor.saveDiagnosis(diagnosis, nestedPath);

      expect(fs.existsSync(nestedPath)).toBe(true);
    });
  });

  describe('createDoctor 工厂函数', () => {
    it('应该创建实例', async () => {
      const { createDoctor } = await import('../monitoring/constraint-doctor');
      const d = createDoctor();
      expect(d).toBeDefined();
    });
  });

  describe('agentDiagnose - LLM 深度诊断', () => {
    it('LLM 未启用时应该返回规则诊断', async () => {
      const mockLLM = createMockLLM('{}');
      const d = new ConstraintDoctor({ enabled: false }, mockLLM);
      const anomaly: TraceAnomaly = {
        type: 'high_bypass_rate',
        constraintId: 'test',
        level: 'guideline',
        message: 'test',
        data: { currentRate: 0.5, threshold: 0.3 },
        detectedAt: Date.now(),
      };

      const diagnosis = await d.diagnose(anomaly);

      expect(diagnosis.rootCause.primary).toContain('绕过');
      expect(mockLLM.complete).not.toHaveBeenCalled();
    });

    it('LLM 启用时应该调用 LLM 并合并结果', async () => {
      const llmResponse = JSON.stringify({
        rootCause: { primary: 'LLM 发现的根因', secondary: ['原因A', '原因B'] },
        impact: { severity: 'high', scope: 'team', userImpact: 'LLM 发现的影响' },
        recommendations: [{ type: 'modify_constraint', content: 'LLM 建议', expectedOutcome: '改善', implementationCost: 'low' }],
        needsChange: true,
        urgency: 'high',
      });
      const mockLLM = createMockLLM(llmResponse);
      const d = new ConstraintDoctor({ enabled: true }, mockLLM);
      const anomaly: TraceAnomaly = {
        type: 'high_bypass_rate',
        constraintId: 'test-constraint',
        level: 'guideline',
        message: 'test',
        data: { currentRate: 0.5, threshold: 0.3 },
        detectedAt: Date.now(),
      };

      const diagnosis = await d.diagnose(anomaly);

      expect(mockLLM.complete).toHaveBeenCalledTimes(1);
      expect(diagnosis.rootCause.primary).toBe('LLM 发现的根因');
      expect(diagnosis.impact.severity).toBe('high');
      expect(diagnosis.recommendations[0].content).toBe('LLM 建议');
    });

    it('LLM 返回被代码块包裹的 JSON 应该正确解析', async () => {
      const llmResponse = '```json\n{"rootCause":{"primary":"嵌套JSON根因"},"needsChange":true}\n```';
      const mockLLM = createMockLLM(llmResponse);
      const d = new ConstraintDoctor({ enabled: true }, mockLLM);
      const anomaly: TraceAnomaly = {
        type: 'rising_fail_rate',
        constraintId: 'test',
        level: 'guideline',
        message: 'test',
        data: { currentRate: 0.5, threshold: 0.3, trend: 'rising' },
        detectedAt: Date.now(),
      };

      const diagnosis = await d.diagnose(anomaly);

      expect(diagnosis.rootCause.primary).toBe('嵌套JSON根因');
    });

    it('LLM 调用失败应该降级到规则诊断', async () => {
      const mockLLM = createMockLLM('');
      (mockLLM.complete as any).mockRejectedValue(new Error('API error'));
      const d = new ConstraintDoctor({ enabled: true }, mockLLM);
      const anomaly: TraceAnomaly = {
        type: 'low_pass_rate',
        constraintId: 'test',
        level: 'guideline',
        message: 'test',
        data: { currentRate: 0.1, threshold: 0.5 },
        detectedAt: Date.now(),
      };

      const diagnosis = await d.diagnose(anomaly);

      // 降级到规则诊断
      expect(diagnosis.rootCause.primary).toContain('通过率');
      expect(diagnosis.needsChange).toBe(true);
    });

    it('LLM 返回无效 JSON 庙该降级到规则诊断', async () => {
      const mockLLM = createMockLLM('这不是 JSON');
      const d = new ConstraintDoctor({ enabled: true }, mockLLM);
      const anomaly: TraceAnomaly = {
        type: 'exception_overuse',
        constraintId: 'test',
        level: 'guideline',
        message: 'test',
        data: { currentRate: 0.6, threshold: 0.2 },
        detectedAt: Date.now(),
      };

      const diagnosis = await d.diagnose(anomaly);

      // 降级到规则诊断
      expect(diagnosis.rootCause.primary).toContain('例外');
    });

    it('应该将 traces 摘要传入 prompt', async () => {
      const mockLLM = createMockLLM('{}');
      const d = new ConstraintDoctor({ enabled: true, maxTracesInPrompt: 5 }, mockLLM);
      d.setData([
        { constraintId: 'test', result: 'fail', timestamp: Date.now() } as any,
        { constraintId: 'test', result: 'bypassed', timestamp: Date.now() } as any,
      ]);
      const anomaly: TraceAnomaly = {
        type: 'high_bypass_rate',
        constraintId: 'test',
        level: 'guideline',
        message: 'test',
        data: { currentRate: 0.5, threshold: 0.3 },
        detectedAt: Date.now(),
      };

      await d.diagnose(anomaly);

      const prompt = (mockLLM.complete as jest.Mock).mock.calls[0][0] as string;
      expect(prompt).toContain('test');
      expect(prompt).toContain('fail');
      expect(prompt).toContain('bypassed');
    });
  });
});