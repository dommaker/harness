/**
 * ConstraintInterceptor 测试
 */

import { ConstraintInterceptor, constraintInterceptor } from '../interceptor';
import { constraintChecker } from '../checker';
import type { Constraint, ConstraintContext, ConstraintTrigger } from '../../../types/constraint';
import type { EnforcementExecutor, EnforcementResult } from '../../../types/enforcement';

// Mock constraintChecker
jest.mock('../checker', () => ({
  constraintChecker: {
    getConstraints: jest.fn(),
    check: jest.fn().mockResolvedValue({ satisfied: true }),
  },
}));

const mockChecker = constraintChecker as jest.Mocked<typeof constraintChecker>;

describe('ConstraintInterceptor', () => {
  let interceptor: ConstraintInterceptor;

  const mockIronLaw: Constraint = {
    id: 'test_iron_law',
    rule: 'Test Iron Law',
    message: 'Test iron law message',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'test-enforcement',
  };

  const mockGuideline: Constraint = {
    id: 'test_guideline',
    rule: 'Test Guideline',
    message: 'Test guideline message',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'guideline-enforcement',
  };

  const mockContext: ConstraintContext = {
    operation: 'code_implementation',
    projectPath: '/test',
  };

  const mockExecutor: EnforcementExecutor = {
    execute: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Use the singleton instance
    interceptor = ConstraintInterceptor.getInstance();
    // Clear any previous state
    interceptor.clearSkips();
    interceptor.setEnabled(true);

    mockChecker.getConstraints.mockReturnValue({
      ironLaws: { test_iron_law: mockIronLaw },
      guidelines: { test_guideline: mockGuideline },
      tips: {},
    });
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = ConstraintInterceptor.getInstance();
      const instance2 = ConstraintInterceptor.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('register', () => {
    it('should register executor', () => {
      interceptor.register('test-enforcement', mockExecutor);
      expect(interceptor.hasExecutor('test-enforcement')).toBe(true);
    });
  });

  describe('registerBatch', () => {
    it('should register multiple executors', () => {
      interceptor.registerBatch([
        { enforcementId: 'exec1', executor: mockExecutor },
        { enforcementId: 'exec2', executor: mockExecutor },
      ]);
      expect(interceptor.hasExecutor('exec1')).toBe(true);
      expect(interceptor.hasExecutor('exec2')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister executor', () => {
      interceptor.register('test-enforcement', mockExecutor);
      const result = interceptor.unregister('test-enforcement');
      expect(result).toBe(true);
      expect(interceptor.hasExecutor('test-enforcement')).toBe(false);
    });

    it('should return false if not exists', () => {
      const result = interceptor.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getExecutor', () => {
    it('should return registered executor', () => {
      interceptor.register('test-enforcement', mockExecutor);
      const executor = interceptor.getExecutor('test-enforcement');
      expect(executor).toBe(mockExecutor);
    });

    it('should return undefined if not registered', () => {
      const executor = interceptor.getExecutor('nonexistent');
      expect(executor).toBeUndefined();
    });
  });

  describe('getRegistrations', () => {
    it('should return all registrations', () => {
      interceptor.unregister('test-enforcement'); // Clear any existing
      interceptor.register('test-enforcement', mockExecutor);
      const registrations = interceptor.getRegistrations();
      const found = registrations.find(r => r.id === 'test-enforcement');
      expect(found).toBeDefined();
    });
  });

  describe('setEnabled', () => {
    it('should disable interceptor', () => {
      interceptor.setEnabled(false);
      interceptor.register('test-enforcement', mockExecutor);

      const result = interceptor.intercept('code_implementation', mockContext);
      // When disabled, should pass without checking
      expect(result).resolves.toHaveProperty('passed', true);
    });
  });

  describe('skip', () => {
    it('should skip specified enforcements', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      interceptor.skip(['test-enforcement']);

      const result = await interceptor.intercept('code_implementation', mockContext);
      expect(result.constraints.some(c => c.skipped)).toBe(true);
    });
  });

  describe('clearSkips', () => {
    it('should clear all skips', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      interceptor.skip(['test-enforcement']);
      interceptor.clearSkips();

      (mockExecutor.execute as jest.Mock).mockResolvedValue({ passed: true });
      await interceptor.intercept('code_implementation', mockContext);
      expect(mockExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('intercept', () => {
    it('should pass when all constraints satisfied', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      interceptor.register('guideline-enforcement', mockExecutor);

      (mockExecutor.execute as jest.Mock).mockResolvedValue({ passed: true });

      const result = await interceptor.intercept('code_implementation', mockContext);
      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it('should fail on iron law violation', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      (mockExecutor.execute as jest.Mock).mockResolvedValue({ passed: false });

      await expect(interceptor.intercept('code_implementation', mockContext)).rejects.toThrow();
    });

    it('should record guideline violation without throwing', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      interceptor.register('guideline-enforcement', mockExecutor);

      (mockExecutor.execute as jest.Mock)
        .mockResolvedValueOnce({ passed: true })  // iron law passes
        .mockResolvedValueOnce({ passed: false }); // guideline fails

      const result = await interceptor.intercept('code_implementation', mockContext);
      expect(result.passed).toBe(true); // guidelines don't block
      expect(result.violations.length).toBe(1);
    });

    it('should handle missing executor', async () => {
      // No constraints at all
      mockChecker.getConstraints.mockReturnValue({
        ironLaws: {},
        guidelines: {},
        tips: {},
      });

      const result = await interceptor.intercept('code_implementation', mockContext);
      expect(result.passed).toBe(true);
      expect(result.constraints.length).toBe(0);
    });

    it('should handle executor error for iron law', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      (mockExecutor.execute as jest.Mock).mockRejectedValue(new Error('Executor error'));

      await expect(interceptor.intercept('code_implementation', mockContext)).rejects.toThrow();
    });
  });

  describe('claim', () => {
    it('should pass when constraints satisfied', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      (mockExecutor.execute as jest.Mock).mockResolvedValue({ passed: true });

      await expect(interceptor.claim('code_implementation', mockContext)).resolves.not.toThrow();
    });

    it('should throw on violation', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      (mockExecutor.execute as jest.Mock).mockResolvedValue({ passed: false });

      await expect(interceptor.claim('code_implementation', mockContext)).rejects.toThrow();
    });
  });

  describe('canProceed', () => {
    it('should return true when passed', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      (mockExecutor.execute as jest.Mock).mockResolvedValue({ passed: true });

      const result = await interceptor.canProceed('code_implementation', mockContext);
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      interceptor.register('test-enforcement', mockExecutor);
      (mockExecutor.execute as jest.Mock).mockRejectedValue(new Error('Error'));

      const result = await interceptor.canProceed('code_implementation', mockContext);
      expect(result).toBe(false);
    });
  });
});
