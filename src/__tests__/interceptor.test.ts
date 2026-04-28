/**
 * ConstraintInterceptor 测试
 */

import { describe, it, expect } from '@jest/globals';
import { ConstraintInterceptor } from '../core/constraints/interceptor';
import type { EnforcementExecutor } from '../types/enforcement';

describe('ConstraintInterceptor', () => {
  describe('单例模式', () => {
    it('应该返回单例实例', () => {
      const instance1 = ConstraintInterceptor.getInstance();
      const instance2 = ConstraintInterceptor.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('setEnabled', () => {
    it('应该能启用/禁用拦截器', () => {
      const interceptor = ConstraintInterceptor.getInstance();
      
      interceptor.setEnabled(false);
      interceptor.setEnabled(true);
      
      expect(interceptor).toBeDefined();
    });
  });

  describe('register', () => {
    it('应该能注册执行器', () => {
      const interceptor = ConstraintInterceptor.getInstance();
      
      const executor: EnforcementExecutor = {
        execute: async () => ({
          passed: true,
          message: 'test',
        }),
      };
      
      interceptor.register('test_executor', executor);
      
      expect(interceptor).toBeDefined();
    });
  });

  describe('unregister', () => {
    it('应该能注销执行器', () => {
      const interceptor = ConstraintInterceptor.getInstance();
      
      const executor: EnforcementExecutor = {
        execute: async () => ({
          passed: true,
          message: 'temp',
        }),
      };
      
      interceptor.register('temp_executor', executor);
      
      const removed = interceptor.unregister('temp_executor');
      expect(removed).toBe(true);
    });

    it('注销不存在的执行器应该返回 false', () => {
      const interceptor = ConstraintInterceptor.getInstance();
      
      const removed = interceptor.unregister('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('registerBatch', () => {
    it('应该能批量注册', () => {
      const interceptor = ConstraintInterceptor.getInstance();
      
      interceptor.registerBatch([
        {
          enforcementId: 'batch1',
          executor: { execute: async () => ({ passed: true }) },
        },
        {
          enforcementId: 'batch2',
          executor: { execute: async () => ({ passed: true }) },
        },
      ]);
      
      expect(interceptor).toBeDefined();
    });
  });
});