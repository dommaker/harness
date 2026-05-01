/**
 * src/types 模块导出覆盖测试
 */

import { describe, it, expect } from '@jest/globals';

// 从 barrel index.ts 导入，覆盖 re-export 行
import {
  ConstraintViolationError,
  IronLawViolationError,
} from '..';

// 从 iron-law.ts 导入，覆盖 value re-export
import { IronLawViolationError as IronLawViolationErrorDirect } from '../iron-law';

describe('types barrel exports', () => {
  it('ConstraintViolationError 应该可从 index 导入', () => {
    expect(ConstraintViolationError).toBeDefined();
    expect(typeof ConstraintViolationError).toBe('function');
  });

  it('IronLawViolationError 应该可从 index 导入（向后兼容）', () => {
    expect(IronLawViolationError).toBeDefined();
    expect(IronLawViolationError.prototype).toBeInstanceOf(ConstraintViolationError);
  });

  it('IronLawViolationError 应该可从 iron-law.ts 直接导入', () => {
    expect(IronLawViolationErrorDirect).toBeDefined();
    expect(IronLawViolationErrorDirect).toBe(ConstraintViolationError);
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

describe('IronLawViolationError', () => {
  it('应该继承 ConstraintViolationError', () => {
    const error = new IronLawViolationError({
      id: 'test',
      level: 'iron_law',
      satisfied: false,
      message: '铁律违规',
      checkedAt: new Date(),
    });

    expect(error).toBeInstanceOf(ConstraintViolationError);
    expect(error.name).toBe('IronLawViolationError');
    expect(error.message).toBe('铁律违规');
  });
});
