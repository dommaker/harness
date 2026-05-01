/**
 * ConstraintDoctor 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ConstraintDoctor } from '../monitoring/constraint-doctor';
import type { TraceAnomaly } from '../types/trace';
import * as fs from 'fs';
import * as path from 'path';

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
});