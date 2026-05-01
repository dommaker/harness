/**
 * TokenBudget 和 TokenEstimator 测试
 */

import { TokenBudget, TokenEstimator, AdaptiveTokenBudget } from '../token-budget';

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

  describe('status', () => {
    it('should return healthy when ratio < 0.5', () => {
      const budget = new TokenBudget(1000);
      budget.consume(400);
      expect(budget.status).toBe('healthy');
    });

    it('should return warning when 0.5 <= ratio < 0.8', () => {
      const budget = new TokenBudget(1000);
      budget.consume(600);
      expect(budget.status).toBe('warning');
    });

    it('should return critical when ratio >= 0.8', () => {
      const budget = new TokenBudget(1000);
      budget.consume(900);
      expect(budget.status).toBe('critical');
    });
  });

  describe('getReport()', () => {
    it('should return budget report', () => {
      const budget = new TokenBudget(1000);
      budget.consume(300);
      budget.reserve(200);

      const report = budget.getReport();

      expect(report.total).toBe(1000);
      expect(report.used).toBe(300);
      expect(report.reserved).toBe(200);
      expect(report.remaining).toBe(500);
      expect(report.usageRatio).toBe(0.3);
      expect(report.status).toBe('healthy');
    });
  });

  describe('forceConsume()', () => {
    it('should consume even beyond budget', () => {
      const budget = new TokenBudget(100);
      budget.forceConsume(200);
      expect(budget.used).toBe(200);
      expect(budget.remaining).toBe(-100);
    });
  });

  describe('addBudget()', () => {
    it('should increase total budget', () => {
      const budget = new TokenBudget(1000);
      budget.addBudget(500);
      expect(budget.total).toBe(1500);
    });
  });

  describe('canAfford()', () => {
    it('should return true when affordable', () => {
      const budget = new TokenBudget(1000);
      expect(budget.canAfford(500)).toBe(true);
    });

    it('should return false when not affordable', () => {
      const budget = new TokenBudget(100);
      expect(budget.canAfford(200)).toBe(false);
    });
  });
});

describe('AdaptiveTokenBudget', () => {
  describe('recordActualUsage()', () => {
    it('should record usage history', () => {
      const budget = new AdaptiveTokenBudget(1000);
      budget.recordActualUsage(500);
      budget.recordActualUsage(600);
      expect(budget.getAverageUsage()).toBe(550);
    });

    it('should trim history when exceeding max size', () => {
      const budget = new AdaptiveTokenBudget(1000);
      for (let i = 0; i < 15; i++) {
        budget.recordActualUsage(100 + i);
      }
      expect(budget.getAverageUsage()).toBeGreaterThan(0);
    });
  });

  describe('getAverageUsage()', () => {
    it('should return 0 when no history', () => {
      const budget = new AdaptiveTokenBudget(1000);
      expect(budget.getAverageUsage()).toBe(0);
    });
  });

  describe('predictNeed()', () => {
    it('should return total when no history', () => {
      const budget = new AdaptiveTokenBudget(1000);
      expect(budget.predictNeed()).toBe(1000);
    });

    it('should predict based on history', () => {
      const budget = new AdaptiveTokenBudget(1000);
      budget.recordActualUsage(400);
      budget.recordActualUsage(500);
      budget.recordActualUsage(600);
      const predicted = budget.predictNeed(0.9);
      expect(predicted).toBeGreaterThan(0);
    });
  });

  describe('suggestBudgetAdjustment()', () => {
    it('should suggest increase when ratio > 0.9', () => {
      const budget = new AdaptiveTokenBudget(1000);
      for (let i = 0; i < 5; i++) {
        budget.recordActualUsage(950);
      }
      const suggestion = budget.suggestBudgetAdjustment();
      expect(suggestion.action).toBe('increase');
      expect(suggestion.suggestedBudget).toBeGreaterThan(1000);
    });

    it('should suggest decrease when ratio < 0.5 and history >= 5', () => {
      const budget = new AdaptiveTokenBudget(1000);
      for (let i = 0; i < 5; i++) {
        budget.recordActualUsage(100);
      }
      const suggestion = budget.suggestBudgetAdjustment();
      expect(suggestion.action).toBe('decrease');
    });

    it('should maintain when ratio is moderate', () => {
      const budget = new AdaptiveTokenBudget(1000);
      for (let i = 0; i < 5; i++) {
        budget.recordActualUsage(600);
      }
      const suggestion = budget.suggestBudgetAdjustment();
      expect(suggestion.action).toBe('maintain');
    });

    it('should maintain when history < 5 even if low usage', () => {
      const budget = new AdaptiveTokenBudget(1000);
      budget.recordActualUsage(100);
      budget.recordActualUsage(100);
      const suggestion = budget.suggestBudgetAdjustment();
      expect(suggestion.action).toBe('maintain');
    });
  });
});