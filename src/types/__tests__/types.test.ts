/**
 * src/types 类型层行为测试
 */

import { describe, it, expect } from '@jest/globals';

import { ConstraintViolationError } from '../constraint';

describe('ConstraintViolationError 导出', () => {
  it('ConstraintViolationError 应该可导入', () => {
    expect(ConstraintViolationError).toBeDefined();
    expect(typeof ConstraintViolationError).toBe('function');
  });
});

describe('ConstraintViolationError', () => {
  it('应该使用 result.message 作为错误消息', () => {
    const error = new ConstraintViolationError({
      id: 'test',
      level: 'iron_law',
      satisfied: false,
      message: '测试违规消息',
      checkedAt: new Date(),
    });

    expect(error.message).toBe('测试违规消息');
    expect(error.name).toBe('ConstraintViolationError');
    expect(error.result.id).toBe('test');
  });

  it('应该在 message 为空时使用默认消息', () => {
    const error = new ConstraintViolationError({
      id: 'test',
      level: 'iron_law',
      satisfied: false,
      checkedAt: new Date(),
    });

    expect(error.message).toBe('Constraint violation');
  });

  it('应该在 message 为空字符串时使用默认消息', () => {
    const error = new ConstraintViolationError({
      id: 'test',
      level: 'iron_law',
      satisfied: false,
      message: '',
      checkedAt: new Date(),
    });

    expect(error.message).toBe('Constraint violation');
  });
});
