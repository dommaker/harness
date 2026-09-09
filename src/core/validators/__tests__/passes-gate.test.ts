/**
 * Tests for passes-gate.ts
 *
 * Priority: test pure logic methods (check)
 * Skip methods that do real file I/O / exec (runTests, runTest, detectTestCommand, etc.)
 * 测试产物解析判定不在此面：见 test-output.test.ts（ADR-0012）
 */

import { PassesGate, createPassesGate } from '../passes-gate';

describe('PassesGate', () => {
  describe('createPassesGate', () => {
    it('creates a PassesGate instance with default config', () => {
      const gate = createPassesGate();
      expect(gate).toBeInstanceOf(PassesGate);
    });

    it('creates a PassesGate instance with custom config', () => {
      const gate = createPassesGate({ enabled: false, allowPartialPass: true });
      expect(gate).toBeInstanceOf(PassesGate);
    });
  });

  describe('check()', () => {
    it('returns allowed=true when test passes and evidence is not required', () => {
      const gate = createPassesGate({ requireEvidence: false });
      const result = gate.check({ passed: true });
      expect(result.allowed).toBe(true);
      expect(result.violations).toBeUndefined();
    });

    it('returns violations when test does not pass', () => {
      const gate = createPassesGate({ requireEvidence: false });
      const result = gate.check({ passed: false });
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations![0].id).toBe('no_self_approval');
    });

    it('returns violations when evidence is missing and requireEvidence is true', () => {
      const gate = createPassesGate({ requireEvidence: true });
      const result = gate.check({ passed: true, evidence: undefined });
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations![0].id).toBe('no_completion_without_verification');
    });

    it('returns both violations when test fails and evidence is missing', () => {
      const gate = createPassesGate({ requireEvidence: true });
      const result = gate.check({ passed: false });
      expect(result.allowed).toBe(false);
      expect(result.violations).toHaveLength(2);
      expect(result.violations![0].id).toBe('no_self_approval');
      expect(result.violations![1].id).toBe('no_completion_without_verification');
    });

    it('returns allowed=true when test passes and evidence is provided', () => {
      const gate = createPassesGate({ requireEvidence: true });
      const result = gate.check({ passed: true, evidence: '/path/to/evidence.log' });
      expect(result.allowed).toBe(true);
    });

    it('preserves the test result in output', () => {
      const gate = createPassesGate();
      const testResult = { passed: true, command: 'npm test', coverage: 85 };
      const result = gate.check(testResult);
      expect(result.testResult).toEqual(testResult);
    });
  });
});
