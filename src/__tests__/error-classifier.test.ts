/**
 * ErrorClassifier 测试
 */

import { describe, it, expect } from '@jest/globals';
import { ErrorClassifier } from '../failure/classifier';
import { ErrorType, FailureLevel } from '../failure/types';

describe('ErrorClassifier', () => {
  const classifier = new ErrorClassifier();

  describe('classify', () => {
    it('应该分类测试失败错误', () => {
      const error = new Error('test failure occurred');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.TEST_FAILED);
      expect(result.level).toBe(FailureLevel.L1);
      expect(result.matchedRule).toBeDefined();
    });

    it('应该分类断言错误', () => {
      const error = new Error('Assertion failed: expected true');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.TEST_FAILED);
    });

    it('应该分类门禁错误', () => {
      const error = new Error('Gate failed: constraint violation');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.GATE_FAILED);
      expect(result.level).toBe(FailureLevel.L2);
    });

    it('应该分类超时错误', () => {
      const error = new Error('Timeout: operation timed out after 5000ms');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.TIMEOUT);
      expect(result.level).toBe(FailureLevel.L1);
    });

    it('应该分类网络错误', () => {
      const error = new Error('Network error: ECONNREFUSED');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.NETWORK_ERROR);
    });

    it('应该分类依赖阻塞错误', () => {
      const error = new Error('dependency blocked: upstream failed');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.DEPENDENCY_BLOCKED);
      expect(result.level).toBe(FailureLevel.L3);
    });

    it('应该分类上下文溢出', () => {
      const error = new Error('context overflow: token limit exceeded');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.CONTEXT_OVERFLOW);
      expect(result.level).toBe(FailureLevel.L2);
    });

    it('应该分类验证错误', () => {
      const error = new Error('validation error: invalid schema');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.VALIDATION_ERROR);
    });

    it('未知错误应该返回 UNKNOWN', () => {
      const error = new Error('某某未知错误某');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.UNKNOWN);
    });

    it('应该保留原始错误', () => {
      const error = new Error('test error');
      const result = classifier.classify(error);

      expect(result.originalError).toBe(error);
    });
  });

  describe('自定义规则', () => {
    it('应该支持自定义分类规则', () => {
      const customClassifier = new ErrorClassifier({
        rules: [
          {
            type: ErrorType.VALIDATION_ERROR,
            keywords: ['custom-error'],
            level: FailureLevel.L3,
          },
        ],
      });

      const error = new Error('custom-error: something went wrong');
      const result = customClassifier.classify(error);

      expect(result.type).toBe(ErrorType.VALIDATION_ERROR);
      expect(result.level).toBe(FailureLevel.L3);
    });

    it('自定义规则优先级高于默认规则', () => {
      const customClassifier = new ErrorClassifier({
        rules: [
          {
            type: ErrorType.GATE_FAILED,
            keywords: ['test'],
            level: FailureLevel.L4,
          },
        ],
      });

      const error = new Error('test failed');
      const result = customClassifier.classify(error);

      expect(result.type).toBe(ErrorType.GATE_FAILED);
    });
  });

  describe('自定义等级映射', () => {
    it('应该支持自定义等级映射', () => {
      const customClassifier = new ErrorClassifier({
        levelMapping: {
          [ErrorType.UNKNOWN]: FailureLevel.L4,
        },
      });

      const error = new Error('某某未知错误某');
      const result = customClassifier.classify(error);

      expect(result.level).toBe(FailureLevel.L4);
    });
  });

  describe('大小写不敏感', () => {
    it('应该忽略大小写', () => {
      const error1 = new Error('TEST FAILURE');
      const error2 = new Error('test failure');
      const error3 = new Error('Test Failure');

      const result1 = classifier.classify(error1);
      const result2 = classifier.classify(error2);
      const result3 = classifier.classify(error3);

      expect(result1.type).toBe(ErrorType.TEST_FAILED);
      expect(result2.type).toBe(ErrorType.TEST_FAILED);
      expect(result3.type).toBe(ErrorType.TEST_FAILED);
    });
  });

  describe('Agent 错误', () => {
    it('应该分类 Agent 错误', () => {
      const error = new Error('agent error: rate limit exceeded');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.AGENT_ERROR);
    });

    it('应该分类 quota 错误', () => {
      const error = new Error('model error: quota exceeded');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.AGENT_ERROR);
    });
  });

  describe('工具错误', () => {
    it('应该分类工具错误', () => {
      const error = new Error('tool error: executor failed');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.TOOL_ERROR);
    });

    it('应该分类 skill 错误', () => {
      const error = new Error('skill error: execution failed');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.TOOL_ERROR);
    });
  });
});
