/**
 * ConstraintViolationHandler 测试（S4）
 */
import { describe, it, expect } from '@jest/globals';
import {
  ConstraintViolationHandler,
  executeWithBlock,
  executeWithCollect,
  executeWithSafeBoolean,
} from '../failure/constraint-handler';
import { ConstraintViolationError } from '../types/constraint';
import type { ConstraintCheckResult } from '../types/constraint';

function makePassingResult(): ConstraintCheckResult {
  return {
    ironLaws: [{ id: 'test_law', level: 'iron_law', satisfied: true, checkedAt: new Date() }],
    guidelines: [],
    tips: [],
    passed: true,
    warningCount: 0,
    tipCount: 0,
  };
}

function makeFailingResult(): ConstraintCheckResult {
  return {
    ironLaws: [{ id: 'test_law', level: 'iron_law', satisfied: false, message: '违规', checkedAt: new Date() }],
    guidelines: [{ id: 'guide', level: 'guideline', satisfied: false, checkedAt: new Date() }],
    tips: [],
    passed: false,
    warningCount: 1,
    tipCount: 0,
  };
}

function makeThrowingFn() {
  return async () => {
    throw new ConstraintViolationError({
      id: 'test_law',
      level: 'iron_law',
      satisfied: false,
      message: '铁律违规',
      checkedAt: new Date(),
    });
  };
}

describe('ConstraintViolationHandler', () => {
  const handler = new ConstraintViolationHandler();

  describe('BLOCK strategy', () => {
    it('通过时返回结果', async () => {
      const result = await handler.execute(() => Promise.resolve(makePassingResult()), 'BLOCK');
      expect(result.strategy).toBe('BLOCK');
      expect(result.hasViolation).toBe(false);
      expect(result.checkResult?.passed).toBe(true);
    });

    it('违规时抛出异常', async () => {
      await expect(
        handler.execute(makeThrowingFn(), 'BLOCK')
      ).rejects.toThrow(ConstraintViolationError);
    });

    it('checkResult 包含 failed 时 hasViolation=true', async () => {
      const result = await handler.execute(() => Promise.resolve(makeFailingResult()), 'BLOCK');
      expect(result.hasViolation).toBe(true);
    });
  });

  describe('COLLECT strategy', () => {
    it('通过时返回完整结果', async () => {
      const result = await handler.execute(() => Promise.resolve(makePassingResult()), 'COLLECT');
      expect(result.strategy).toBe('COLLECT');
      expect(result.hasViolation).toBe(false);
      expect(result.checkResult).toBeDefined();
    });

    it('checkResult 有违规时 hasViolation=true', async () => {
      const result = await handler.execute(() => Promise.resolve(makeFailingResult()), 'COLLECT');
      expect(result.hasViolation).toBe(true);
      expect(result.violationCount).toBe(2); // 1 iron + 1 guideline
    });

    it('抛出异常时捕获并返回空结果', async () => {
      const result = await handler.execute(makeThrowingFn(), 'COLLECT');
      expect(result.strategy).toBe('COLLECT');
      expect(result.hasViolation).toBe(true);
      expect(result.checkResult).toBeDefined();
      expect(result.checkResult!.passed).toBe(false);
    });
  });

  describe('SAFE_BOOLEAN strategy', () => {
    it('通过时返回 false', async () => {
      const result = await handler.execute(() => Promise.resolve(makePassingResult()), 'SAFE_BOOLEAN');
      expect(result.strategy).toBe('SAFE_BOOLEAN');
      expect(result.hasViolation).toBe(false);
    });

    it('违规时返回 true', async () => {
      const result = await handler.execute(() => Promise.resolve(makeFailingResult()), 'SAFE_BOOLEAN');
      expect(result.hasViolation).toBe(true);
    });

    it('抛出异常时返回 true', async () => {
      const result = await handler.execute(makeThrowingFn(), 'SAFE_BOOLEAN');
      expect(result.hasViolation).toBe(true);
    });
  });
});

describe('快捷函数', () => {
  it('executeWithBlock 通过', async () => {
    const result = await executeWithBlock(() => Promise.resolve(makePassingResult()));
    expect(result.strategy).toBe('BLOCK');
    expect(result.hasViolation).toBe(false);
  });

  it('executeWithBlock 违规抛出', async () => {
    await expect(
      executeWithBlock(makeThrowingFn())
    ).rejects.toThrow(ConstraintViolationError);
  });

  it('executeWithCollect 异常不抛出', async () => {
    const result = await executeWithCollect(makeThrowingFn());
    expect(result.hasViolation).toBe(true);
    expect(result.checkResult).toBeDefined();
  });

  it('executeWithSafeBoolean 异常返回 true', async () => {
    const result = await executeWithSafeBoolean(makeThrowingFn());
    expect(result.hasViolation).toBe(true);
  });
});
