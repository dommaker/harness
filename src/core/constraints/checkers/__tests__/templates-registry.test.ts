/**
 * 两层注册表闭环校验扩展（ADR-0033 块 3 子项 1）测试
 *
 * - getConstraintCheck：字符串 id / 内置约束走内置注册表（现状不动）；
 *   source='app' 按模板 id + params 实例化；模板 id 未注册 → 抛错（闭环保留）
 * - 内置对账闭环不动：每条 kind=check 内置约束有 checker、无孤儿实现
 *   （既有断言在 src/__tests__/iron-laws.test.ts，此处只补应用层维度）
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import {
  getConstraintCheck,
  TEMPLATES,
  type ConstraintCheck,
  type TemplatedCheckerFactory,
} from '../index';
import type { Constraint } from '../../../../types/constraint';

const FAKE_PARAMS = { p: 1 };

const fakeFactory: TemplatedCheckerFactory = {
  validateParams: () => [],
  create: (id, params) => ({
    id,
    evaluate: () => ({ pass: params === FAKE_PARAMS || params.p === 1 }),
  }),
};

function appConstraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    id: 'app_fake',
    kind: 'check',
    rule: 'r',
    message: 'm',
    severity: 'warning',
    trigger: 'commit',
    enforcement: '',
    source: 'app',
    checker: 'fake-template',
    params: FAKE_PARAMS,
    ...overrides,
  };
}

afterEach(() => {
  TEMPLATES.delete('fake-template');
});

describe('getConstraintCheck 两层分发', () => {
  it('字符串 id 走内置注册表（现状口径：未注册返回 undefined）', () => {
    expect(getConstraintCheck('capability_sync')).toBeDefined();
    expect(getConstraintCheck('removed_legacy')).toBeUndefined();
  });

  it('内置约束对象按 id 查找（source 缺省 = builtin）', () => {
    const builtin: Constraint = {
      id: 'capability_sync',
      kind: 'check',
      rule: 'r',
      message: 'm',
      severity: 'warning',
      trigger: 'module_modification',
      enforcement: 'update-capabilities',
    };
    expect(getConstraintCheck(builtin)?.id).toBe('capability_sync');
  });

  it('source=app：按模板 id + params 实例化 checker', () => {
    TEMPLATES.set('fake-template', fakeFactory);
    const check = getConstraintCheck(appConstraint()) as ConstraintCheck;
    expect(check.id).toBe('app_fake');
  });

  it('source=app 模板未注册 → 抛错（闭环保留，不许静默 pass）', () => {
    expect(() => getConstraintCheck(appConstraint())).toThrow(/未注册/);
  });

  it('source=app 缺 checker 字段 → 抛错', () => {
    expect(() => getConstraintCheck(appConstraint({ checker: undefined }))).toThrow(/闭环校验失败/);
  });
});
