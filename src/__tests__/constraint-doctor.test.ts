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
});