/**
 * VerificationLoop 测试
 */

import { VerificationLoop } from '../loop';
import type { VerificationLoopConfig, GatherState, VerificationResult } from '../types';

describe('VerificationLoop', () => {
  const baseConfig: VerificationLoopConfig = {
    maxRetries: 3,
    rules: [
      {
        id: 'test-rule',
        type: 'custom',
        name: 'Test Rule',
        description: 'Test',
        verify: async () => ({ passed: true, ruleId: 'test-rule', duration: 0 }),
      },
    ],
  };

  describe('run', () => {
    it('应该在首次通过时返回 passed', async () => {
      const loop = new VerificationLoop(baseConfig);
      const gather = async (): Promise<GatherState> => ({
        changedFiles: [],
        metadata: {},
      });

      const snapshot = await loop.run({ projectRoot: '.' }, gather);
      expect(snapshot.status).toBe('passed');
      expect(snapshot.attempt).toBe(1);
      expect(snapshot.results.every(r => r.passed)).toBe(true);
    });

    it('应该在验证失败时重试', async () => {
      let callCount = 0;
      const config: VerificationLoopConfig = {
        maxRetries: 3,
        rules: [
          {
            id: 'flaky',
            type: 'custom',
            name: 'Flaky',
            description: '',
            verify: async () => {
              callCount++;
              return {
                passed: callCount >= 2,
                ruleId: 'flaky',
                message: callCount < 2 ? 'not yet' : 'ok',
                duration: 0,
              };
            },
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const gather = async (): Promise<GatherState> => ({
        changedFiles: [],
        metadata: {},
      });

      const snapshot = await loop.run({ projectRoot: '.' }, gather);
      expect(snapshot.status).toBe('passed');
      expect(snapshot.attempt).toBe(2);
    });

    it('应该在达到最大重试次数后失败', async () => {
      const config: VerificationLoopConfig = {
        maxRetries: 2,
        rules: [
          {
            id: 'always-fail',
            type: 'custom',
            name: 'Always Fail',
            description: '',
            verify: async () => ({
              passed: false,
              ruleId: 'always-fail',
              message: 'nope',
              duration: 0,
            }),
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const gather = async (): Promise<GatherState> => ({
        changedFiles: [],
        metadata: {},
      });

      const snapshot = await loop.run({ projectRoot: '.' }, gather);
      expect(snapshot.status).toBe('failed');
      expect(snapshot.attempt).toBe(2);
      expect(snapshot.lastError).toContain('最大重试次数');
    });

    it('failFast 应该在首次失败时立即停止', async () => {
      let verifyCount = 0;
      const config: VerificationLoopConfig = {
        maxRetries: 5,
        failFast: true,
        rules: [
          {
            id: 'fail-fast-rule',
            type: 'custom',
            name: 'Fail Fast',
            description: '',
            verify: async () => {
              verifyCount++;
              return {
                passed: false,
                ruleId: 'fail-fast-rule',
                duration: 0,
              };
            },
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
      );

      expect(snapshot.status).toBe('failed');
      expect(snapshot.attempt).toBe(1);
      expect(verifyCount).toBe(1);
    });

    it('应该在 gather 失败时返回 failed', async () => {
      const loop = new VerificationLoop(baseConfig);
      const gather = async (): Promise<GatherState> => {
        throw new Error('gather failed');
      };

      const snapshot = await loop.run({ projectRoot: '.' }, gather);
      expect(snapshot.status).toBe('failed');
      expect(snapshot.lastError).toContain('Gather 失败');
    });

    it('应该在 act 返回 abort 时中止', async () => {
      let verifyCount = 0;
      const config: VerificationLoopConfig = {
        maxRetries: 3,
        rules: [
          {
            id: 'fail-rule',
            type: 'custom',
            name: 'Fail',
            description: '',
            verify: async () => {
              verifyCount++;
              return { passed: false, ruleId: 'fail-rule', duration: 0 };
            },
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
        async () => ({ type: 'abort', description: '无法修复' }),
      );

      expect(snapshot.status).toBe('failed');
      expect(snapshot.lastError).toContain('中止');
      // 只执行了 1 次 verify（第 2 轮 act 返回 abort 后未进入 verify）
      expect(verifyCount).toBe(1);
    });

    it('应该在 act 返回 skip 时跳过', async () => {
      const config: VerificationLoopConfig = {
        maxRetries: 3,
        rules: [
          {
            id: 'fail-rule',
            type: 'custom',
            name: 'Fail',
            description: '',
            verify: async () => ({ passed: false, ruleId: 'fail-rule', duration: 0 }),
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
        async () => ({ type: 'skip', description: '跳过' }),
      );

      expect(snapshot.status).toBe('passed');
    });

    it('第 1 轮不应该调用 act', async () => {
      let actCalled = false;
      const loop = new VerificationLoop(baseConfig);

      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
        async () => {
          actCalled = true;
          return { type: 'retry', description: 'retry' };
        },
      );

      expect(snapshot.status).toBe('passed');
      expect(actCalled).toBe(false);
    });

    it('应该在 act 抛出异常时返回 failed', async () => {
      const config: VerificationLoopConfig = {
        maxRetries: 3,
        rules: [
          {
            id: 'fail-rule',
            type: 'custom',
            name: 'Fail',
            description: '',
            verify: async () => ({ passed: false, ruleId: 'fail-rule', duration: 0 }),
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
        async () => { throw new Error('act crashed'); },
      );

      expect(snapshot.status).toBe('failed');
      expect(snapshot.lastError).toContain('Act 失败');
      expect(snapshot.lastError).toContain('act crashed');
    });

    it('应该在 verify 函数抛出异常时视为失败并重试', async () => {
      const config: VerificationLoopConfig = {
        maxRetries: 2,
        rules: [
          {
            id: 'throw-rule',
            type: 'custom',
            name: 'Throw',
            description: '',
            verify: async () => { throw new Error('verify crashed'); },
          },
        ],
      };

      const loop = new VerificationLoop(config);
      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
      );

      // verifyRule 内部 catch 了异常，返回 passed: false
      // 循环重试 maxRetries 次后失败
      expect(snapshot.status).toBe('failed');
      expect(snapshot.attempt).toBe(2);
      expect(snapshot.results[0].message).toContain('verify crashed');
    });
  });

  describe('snapshot', () => {
    it('应该包含完整快照信息', async () => {
      const loop = new VerificationLoop(baseConfig);
      const snapshot = await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
      );

      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.maxRetries).toBe(3);
      expect(Array.isArray(snapshot.results)).toBe(true);
    });
  });

  describe('getters', () => {
    it('应该返回当前状态', async () => {
      const loop = new VerificationLoop(baseConfig);
      expect(loop.getStatus()).toBe('idle');
      expect(loop.getAttempt()).toBe(0);
      expect(loop.getResults()).toEqual([]);

      await loop.run(
        { projectRoot: '.' },
        async () => ({ changedFiles: [], metadata: {} }),
      );

      expect(loop.getStatus()).toBe('passed');
      expect(loop.getAttempt()).toBe(1);
      expect(loop.getResults().length).toBeGreaterThan(0);
    });
  });
});
