/**
 * ConstraintDoctor 测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConstraintDoctor, createDoctor } from '../monitoring/constraint-doctor';
import type { ExecutionTrace, TraceAnomaly } from '../types/trace';

describe('ConstraintDoctor', () => {
  let tempDir: string;
  let doctor: ConstraintDoctor;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `harness-traces-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    doctor = createDoctor();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('should diagnose high bypass rate anomaly', async () => {
    // 创建异常
    const anomaly: TraceAnomaly = {
      type: 'high_bypass_rate',
      constraintId: 'test_constraint',
      level: 'guideline',
      message: 'Bypass rate 40%',
      data: {
        currentRate: 0.4,
        threshold: 0.3,
      },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    // 添加 traces
    const traces: ExecutionTrace[] = [];
    for (let i = 0; i < 10; i++) {
      traces.push({
        constraintId: 'test_constraint',
        level: 'guideline',
        timestamp: Date.now() - i * 60 * 1000,
        result: i < 6 ? 'bypassed' : 'pass',
      });
    }
    doctor.setData(traces);

    // 诊断
    const diagnosis = await doctor.diagnose(anomaly);

    expect(diagnosis.constraintId).toBe('test_constraint');
    expect(diagnosis.needsChange).toBe(true);
    expect(diagnosis.rootCause.primary).toContain('过于严格');
    expect(diagnosis.recommendations.length).toBeGreaterThan(0);
    expect(diagnosis.recommendations[0].type).toBe('add_exception');
  });

  test('should diagnose rising fail rate anomaly', async () => {
    const anomaly: TraceAnomaly = {
      type: 'rising_fail_rate',
      constraintId: 'another_constraint',
      level: 'iron_law',
      message: 'Fail rate rising',
      data: {
        currentRate: 0.6,
        threshold: 0.5,
        trend: 'rising',
      },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);

    expect(diagnosis.needsChange).toBe(true);
    expect(diagnosis.impact.severity).toBe('high'); // Iron law
    expect(diagnosis.urgency).toBe('medium'); // Iron law 强制 medium+
  });

  test('should detect exception overuse', async () => {
    const anomaly: TraceAnomaly = {
      type: 'exception_overuse',
      constraintId: 'constraint_with_exceptions',
      level: 'guideline',
      message: 'Exception rate 50%',
      data: {
        currentRate: 0.5,
        threshold: 0.4,
      },
      detectedAt: Date.now(),
      suggestedAction: 'add_exception',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);

    expect(diagnosis.rootCause.primary).toContain('过度使用');
    expect(diagnosis.recommendations[0].type).toBe('modify_constraint');
  });

  test('should generate diagnosis report', async () => {
    const anomaly: TraceAnomaly = {
      type: 'high_bypass_rate',
      constraintId: 'test',
      level: 'guideline',
      message: 'Test',
      data: {
        currentRate: 0.5,
        threshold: 0.3,
      },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);
    const report = doctor.generateReport(diagnosis);

    expect(report).toContain('# Diagnosis Report');
    expect(report).toContain('Root Cause');
    expect(report).toContain('Recommendations');
    expect(report).toContain('test');
  });

  test('should save and load diagnosis', async () => {
    const anomaly: TraceAnomaly = {
      type: 'high_bypass_rate',
      constraintId: 'save_test',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);

    const outputPath = path.join(tempDir, 'diagnosis.json');
    doctor.saveDiagnosis(diagnosis, outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);

    const loaded = doctor.loadDiagnosis(outputPath);
    expect(loaded.constraintId).toBe('save_test');
    expect(loaded.needsChange).toBe(true);
  });
});
