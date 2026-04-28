/**
 * TokenBudget 和 TokenEstimator 测试
 */

import { TokenBudget, TokenEstimator } from '../token-budget';

describe('TokenEstimator', () => {
  describe('estimateText()', () => {
    it('should return 0 for empty text', () => {
      expect(TokenEstimator.estimateText('')).toBe(0);
    });

    it('should estimate English text', () => {
      const text = 'Hello world'; // 11 chars / 4 ≈ 3 tokens
      const estimate = TokenEstimator.estimateText(text);
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThanOrEqual(5);
    });

    it('should estimate Chinese text', () => {
      const text = '你好世界'; // 4 chars / 1.5 ≈ 3 tokens
      const estimate = TokenEstimator.estimateText(text);
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThanOrEqual(5);
    });

    it('should handle mixed text', () => {
      const text = 'Hello 世界'; // Mixed
      const estimate = TokenEstimator.estimateText(text);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should use ceil for rounding', () => {
      const text = 'ab'; // 2 chars / 4 = 0.5 → ceil = 1
      const estimate = TokenEstimator.estimateText(text);
      expect(estimate).toBe(1);
    });
  });

  describe('estimateObject()', () => {
    it('should estimate object tokens', () => {
      const obj = { name: 'test', value: 123 };
      const estimate = TokenEstimator.estimateObject(obj);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should estimate nested object', () => {
      const obj = { nested: { level1: { level2: 'deep' } } };
      const estimate = TokenEstimator.estimateObject(obj);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should return 0 for circular reference', () => {
      const obj: any = { name: 'test' };
      obj.self = obj; // Circular reference
      const estimate = TokenEstimator.estimateObject(obj);
      expect(estimate).toBe(0);
    });
  });

  describe('estimateArray()', () => {
    it('should estimate array tokens', () => {
      const arr = ['a', 'b', 'c'];
      const estimate = TokenEstimator.estimateArray(arr);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should use custom item estimator', () => {
      const items = [{ text: 'hello' }, { text: 'world' }];
      const estimate = TokenEstimator.estimateArray(items, (item) =>
        TokenEstimator.estimateText(item.text)
      );
      expect(estimate).toBeGreaterThan(0);
    });

    it('should handle empty array', () => {
      const estimate = TokenEstimator.estimateArray([]);
      expect(estimate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createFieldEstimator()', () => {
    it('should create field-based estimator', () => {
      const estimator = TokenEstimator.createFieldEstimator<{ name: string; desc: string }>({
        name: (v) => TokenEstimator.estimateText(v),
        desc: (v) => TokenEstimator.estimateText(v),
      });

      const item = { name: 'test', desc: 'description' };
      const estimate = estimator(item);
      expect(estimate).toBeGreaterThan(0);
    });
  });
});

describe('TokenBudget', () => {
  describe('constructor', () => {
    it('should create budget with given amount', () => {
      const budget = new TokenBudget(1000);
      expect(budget.total).toBe(1000);
      expect(budget.used).toBe(0);
      expect(budget.remaining).toBe(1000);
    });
  });

  describe('reserve()', () => {
    it('should reserve tokens', () => {
      const budget = new TokenBudget(1000);
      const success = budget.reserve(200);
      expect(success).toBe(true);
      expect(budget.remaining).toBe(800);
    });

    it('should fail when not enough remaining', () => {
      const budget = new TokenBudget(100);
      const success = budget.reserve(200);
      expect(success).toBe(false);
      expect(budget.remaining).toBe(100);
    });

    it('should allow multiple reserves', () => {
      const budget = new TokenBudget(1000);
      budget.reserve(200);
      budget.reserve(300);
      expect(budget.remaining).toBe(500);
    });
  });

  describe('release()', () => {
    it('should release reserved tokens', () => {
      const budget = new TokenBudget(1000);
      budget.reserve(200);
      budget.release(100);
      expect(budget.remaining).toBe(900);
    });

    it('should not go below zero', () => {
      const budget = new TokenBudget(1000);
      budget.reserve(50);
      budget.release(100); // More than reserved
      expect(budget.remaining).toBe(1000);
    });
  });

  describe('consume()', () => {
    it('should consume tokens', () => {
      const budget = new TokenBudget(1000);
      const success = budget.consume(100);
      expect(success).toBe(true);
      expect(budget.used).toBe(100);
      expect(budget.remaining).toBe(900);
    });

    it('should fail when not enough remaining', () => {
      const budget = new TokenBudget(100);
      const success = budget.consume(200);
      expect(success).toBe(false);
      expect(budget.used).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should reset used tokens', () => {
      const budget = new TokenBudget(1000);
      budget.consume(500);
      budget.reset();
      expect(budget.used).toBe(0);
      expect(budget.remaining).toBe(1000);
    });

    it('should update total with new budget', () => {
      const budget = new TokenBudget(1000);
      budget.consume(500);
      budget.reset(2000);
      expect(budget.total).toBe(2000);
      expect(budget.used).toBe(0);
    });
  });

  describe('usageRatio', () => {
    it('should return usage ratio', () => {
      const budget = new TokenBudget(1000);
      budget.consume(500);
      expect(budget.usageRatio).toBe(0.5);
    });

    it('should return 0 when not used', () => {
      const budget = new TokenBudget(1000);
      expect(budget.usageRatio).toBe(0);
    });
  });
});