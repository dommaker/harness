/**
 * AS-006 PassesGate.check() 测试
 * 
 * 验证纯约束接口：harness 只负责验证结果，不负责运行测试
 */

import { PassesGate } from '../core/validators/passes-gate';
import type { TestResult, PassesGateCheckResult } from '../types/passes-gate';

describe('PassesGate.check()', () => {
  /**
   * AC-001：PassesGate.check() 接口存在
   */
  it('AC-001: should have check() method', () => {
    const gate = new PassesGate();
    expect(gate.check).toBeDefined();
    expect(typeof gate.check).toBe('function');
  });

  /**
   * AC-002：测试未通过返回 Iron Law #2 违规
   */
  it('AC-002: should return no_self_approval violation when test failed', () => {
    const gate = new PassesGate({ requireEvidence: false });  // 只检查测试通过
    const testResult: TestResult = { passed: false };

    const result = gate.check(testResult);

    expect(result.allowed).toBe(false);
    expect(result.violations).toBeDefined();
    expect(result.violations?.length).toBe(1);
    expect(result.violations?.[0]?.id).toBe('no_self_approval');
    expect(result.violations?.[0]?.level).toBe('iron_law');
    expect(result.testResult).toEqual(testResult);
  });

  /**
   * AC-003：缺少证据返回 Iron Law #3 违规
   */
  it('AC-003: should return no_completion_without_verification violation when missing evidence', () => {
    const gate = new PassesGate({ requireEvidence: true });
    const testResult: TestResult = { passed: true };

    const result = gate.check(testResult);

    expect(result.allowed).toBe(false);
    expect(result.violations).toBeDefined();
    expect(result.violations?.length).toBe(1);
    expect(result.violations?.[0]?.id).toBe('no_completion_without_verification');
    expect(result.violations?.[0]?.level).toBe('iron_law');
    expect(result.testResult).toEqual(testResult);
  });

  /**
   * AC-004：测试通过且有证据返回 allowed=true
   */
  it('AC-004: should return allowed=true when test passed with evidence', () => {
    const gate = new PassesGate({ requireEvidence: true });
    const testResult: TestResult = {
      passed: true,
      evidence: '/tmp/test-2026-04-27.log',
    };

    const result = gate.check(testResult);

    expect(result.allowed).toBe(true);
    expect(result.violations).toBeUndefined();
    expect(result.testResult).toEqual(testResult);
  });

  /**
   * AC-005：requireEvidence=false 时允许无证据
   */
  it('AC-005: should allow without evidence when requireEvidence=false', () => {
    const gate = new PassesGate({ requireEvidence: false });
    const testResult: TestResult = { passed: true };

    const result = gate.check(testResult);

    expect(result.allowed).toBe(true);
    expect(result.violations).toBeUndefined();
  });

  /**
   * AC-006：TestResult 类型导出
   */
  it('AC-006: should export TestResult and PassesGateCheckResult types', () => {
    // TypeScript 类型检查，运行时验证
    const testResult: TestResult = { passed: true };
    const gate = new PassesGate();
    const checkResult: PassesGateCheckResult = gate.check(testResult);

    expect(checkResult.allowed).toBeDefined();
    expect(typeof checkResult.allowed).toBe('boolean');
  });

  /**
   * AC-007：保留原有 setPasses() 方法（向后兼容）
   */
  it('AC-007: should keep setPasses() method for backward compatibility', () => {
    const gate = new PassesGate();
    expect(gate.setPasses).toBeDefined();
    expect(typeof gate.setPasses).toBe('function');
  });

  /**
   * 边界测试：同时存在多个违规
   */
  it('should return both violations when test failed and missing evidence', () => {
    const gate = new PassesGate({ requireEvidence: true });
    const testResult: TestResult = { passed: false };

    const result = gate.check(testResult);

    // 测试未通过是主要违规，证据检查次之
    expect(result.allowed).toBe(false);
    expect(result.violations?.length).toBeGreaterThanOrEqual(1);
    expect(result.violations?.[0]?.id).toBe('no_self_approval');
  });

  /**
   * 边界测试：覆盖率可选字段
   */
  it('should accept optional coverage field', () => {
    const gate = new PassesGate({ requireEvidence: false });
    const testResult: TestResult = {
      passed: true,
      coverage: 85.5,
      command: 'npm test',
      failures: [],
    };

    const result = gate.check(testResult);

    expect(result.allowed).toBe(true);
    expect(result.testResult?.coverage).toBe(85.5);
  });
});