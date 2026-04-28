/**
 * TokenEstimator 和 TokenBudget 测试
 */

import { describe, it, expect } from '@jest/globals';
import { TokenEstimator, TokenBudget } from '../context/token-budget';

describe('TokenEstimator', () => {
  describe('estimateText', () => {
    it('空字符串应该返回 0', () => {
      expect(TokenEstimator.estimateText('')).toBe(0);
    });

    it('应该估算英文文本', () => {
      const text = 'hello world';  // 11 字符 ≈ 3 tokens
      const tokens = TokenEstimator.estimateText(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('应该估算中文文本', () => {
      const text = '你好世界';  // 4 字符 ≈ 3 tokens
      const tokens = TokenEstimator.estimateText(text);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('中英文混合应该按中文计算', () => {
      const text = 'hello世界';  // 含中文，按中文比例
      const tokens = TokenEstimator.estimateText(text);

      expect(tokens).toBeGreaterThan(0);
    });

    it('长文本应该返回更大的值', () => {
      const shortText = 'hello';
      const longText = 'hello world this is a longer text for testing';

      const shortTokens = TokenEstimator.estimateText(shortText);
      const longTokens = TokenEstimator.estimateText(longText);

      expect(longTokens).toBeGreaterThan(shortTokens);
    });
  });

  describe('estimateObject', () => {
    it('应该估算对象的 Token 数', () => {
      const obj = { name: 'test', value: 123 };
      const tokens = TokenEstimator.estimateObject(obj);

      expect(tokens).toBeGreaterThan(0);
    });

    it('嵌套对象应该正确估算', () => {
      const obj = {
        user: {
          name: 'test',
          email: 'test@example.com',
        },
        items: [1, 2, 3],
      };
      const tokens = TokenEstimator.estimateObject(obj);

      expect(tokens).toBeGreaterThan(0);
    });

    it('无法 JSON 序列化应该返回 0', () => {
      const obj: any = {};
      obj.self = obj;  // 循环引用

      const tokens = TokenEstimator.estimateObject(obj);

      expect(tokens).toBe(0);
    });
  });

  describe('estimateArray', () => {
    it('应该估算数组的 Token 数', () => {
      const arr = [1, 2, 3, 4, 5];
      const tokens = TokenEstimator.estimateArray(arr);

      expect(tokens).toBeGreaterThan(0);
    });

    it('应该支持自定义估算器', () => {
      const items = [
        { name: 'item1', description: 'desc1' },
        { name: 'item2', description: 'desc2' },
      ];
      const customEstimator = (item: any) => TokenEstimator.estimateText(item.name);

      const tokens = TokenEstimator.estimateArray(items, customEstimator);

      expect(tokens).toBeGreaterThan(0);
    });

    it('空数组应该返回较小值', () => {
      expect(TokenEstimator.estimateArray([])).toBeLessThan(5);
    });
  });

  describe('createFieldEstimator', () => {
    it('应该创建字段估算器', () => {
      interface TestItem {
        title: string;
        content: string;
      }

      const estimator = TokenEstimator.createFieldEstimator<TestItem>({
        title: (v) => TokenEstimator.estimateText(v),
        content: (v) => TokenEstimator.estimateText(v),
      });

      const item: TestItem = {
        title: 'Test Title',
        content: 'Test Content',
      };

      const tokens = estimator(item);

      expect(tokens).toBeGreaterThan(0);
    });
  });
});

describe('TokenBudget', () => {
  describe('constructor', () => {
    it('应该初始化预算', () => {
      const budget = new TokenBudget(10000);

      expect(budget.total).toBe(10000);
      expect(budget.used).toBe(0);
      expect(budget.remaining).toBe(10000);
    });
  });

  describe('reserve', () => {
    it('应该预留预算', () => {
      const budget = new TokenBudget(10000);

      const result = budget.reserve(1000);

      expect(result).toBe(true);
      expect(budget.remaining).toBe(9000);
    });

    it('超出限制应该失败', () => {
      const budget = new TokenBudget(1000);

      const result = budget.reserve(2000);

      expect(result).toBe(false);
    });
  });

  describe('consume', () => {
    it('应该使用预算', () => {
      const budget = new TokenBudget(10000);

      const result = budget.consume(1000);

      expect(result).toBe(true);
      expect(budget.used).toBe(1000);
      expect(budget.remaining).toBe(9000);
    });

    it('超出限制应该失败', () => {
      const budget = new TokenBudget(1000);

      const result = budget.consume(2000);

      expect(result).toBe(false);
      expect(budget.used).toBe(0);
    });
  });

  describe('forceConsume', () => {
    it('应该强制使用预算（可能超预算）', () => {
      const budget = new TokenBudget(1000);

      budget.forceConsume(2000);

      expect(budget.used).toBe(2000);
    });
  });

  describe('release', () => {
    it('应该释放预留的预算', () => {
      const budget = new TokenBudget(10000);

      budget.reserve(1000);
      budget.release(500);

      expect(budget.remaining).toBe(9500);
    });

    it('释放超过预留的量应该不会变成负数', () => {
      const budget = new TokenBudget(10000);

      budget.reserve(100);
      budget.release(200);

      expect(budget.remaining).toBe(10000);
    });
  });

  describe('addBudget', () => {
    it('应该增加预算', () => {
      const budget = new TokenBudget(10000);

      budget.addBudget(5000);

      expect(budget.total).toBe(15000);
    });
  });

  describe('canAfford', () => {
    it('应该检查是否有足够预算', () => {
      const budget = new TokenBudget(10000);

      expect(budget.canAfford(5000)).toBe(true);
      expect(budget.canAfford(15000)).toBe(false);
    });

    it('使用后应该正确计算', () => {
      const budget = new TokenBudget(10000);

      budget.consume(5000);

      expect(budget.canAfford(5000)).toBe(true);
      expect(budget.canAfford(5001)).toBe(false);
    });
  });

  describe('usageRatio', () => {
    it('应该计算使用比例', () => {
      const budget = new TokenBudget(10000);

      budget.consume(5000);

      expect(budget.usageRatio).toBe(0.5);
    });

    it('未使用应该返回 0', () => {
      const budget = new TokenBudget(10000);

      expect(budget.usageRatio).toBe(0);
    });
  });
});
