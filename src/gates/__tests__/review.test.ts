/**
 * ReviewGate 测试
 */

import { ReviewGate } from '../review';
import { exec } from 'child_process';

// Mock exec
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;

describe('ReviewGate', () => {
  let gate: ReviewGate;
  const baseContext = {
    projectPath: '/test/project',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gate = new ReviewGate();
  });

  describe('constructor', () => {
    it('should use default config', async () => {
      // 缺省 minReviewers=1：单个 APPROVED 即通过
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [{ state: 'APPROVED', author: { login: 'alice' } }],
            state: 'open',
          }),
        });
      });

      const result = await gate.check({ ...baseContext, prNumber: 123 });
      expect(result.passed).toBe(true);
    });

    it('should accept custom config', async () => {
      const customGate = new ReviewGate({
        minReviewers: 2,
        requireApproval: false,
        blockOnChangesRequested: false,
        allowedReviewers: ['alice', 'bob'],
      });

      // minReviewers=2：单个 APPROVED 不够
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [{ state: 'APPROVED', author: { login: 'alice' } }],
            state: 'open',
          }),
        });
      });

      const result = await customGate.check({ ...baseContext, prNumber: 123 });
      expect(result.passed).toBe(false);
    });
  });

  describe('check() - GitHub PR', () => {
    it('should pass when PR has enough approvals', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [
              { state: 'APPROVED', author: { login: 'alice' } },
              { state: 'APPROVED', author: { login: 'bob' } },
            ],
            state: 'open',
          }),
        });
      });

      const result = await gate.check({
        ...baseContext,
        prNumber: 123,
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('审查通过');
    });

    it('should fail when not enough approvals', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [{ state: 'APPROVED', author: { login: 'alice' } }],
            state: 'open',
          }),
        });
      });

      const strictGate = new ReviewGate({ minReviewers: 2 });

      const result = await strictGate.check({
        ...baseContext,
        prNumber: 123,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('审查未通过');
    });

    it('should fail when changes requested', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [
              { state: 'APPROVED', author: { login: 'alice' } },
              { state: 'CHANGES_REQUESTED', author: { login: 'bob' } },
            ],
            state: 'open',
          }),
        });
      });

      const result = await gate.check({
        ...baseContext,
        prNumber: 123,
      });

      expect(result.passed).toBe(false);
      expect(result.details?.changesRequested).toBe(1);
    });

    it('should pass when changes requested but not blocked', async () => {
      const lenientGate = new ReviewGate({
        blockOnChangesRequested: false,
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [
              { state: 'APPROVED', author: { login: 'alice' } },
              { state: 'CHANGES_REQUESTED', author: { login: 'bob' } },
            ],
            state: 'open',
          }),
        });
      });

      const result = await lenientGate.check({
        ...baseContext,
        prNumber: 123,
      });

      expect(result.passed).toBe(true);
    });

    it('should handle gh CLI error', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('gh: command not found'), null);
      });

      const result = await gate.check({
        ...baseContext,
        prNumber: 123,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('无法获取');
    });

    it('should handle empty reviews', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, {
          stdout: JSON.stringify({
            reviews: [],
            state: 'open',
          }),
        });
      });

      const result = await gate.check({
        ...baseContext,
        prNumber: 123,
      });

      expect(result.passed).toBe(false);
      expect(result.details?.approvals).toBe(0);
    });
  });

  describe('check() - Local Git', () => {
    it('should fail when requireApproval is true (default)', async () => {
      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: 'abc123 Initial commit' });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: '' });
        });

      const result = await gate.check(baseContext);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('本地模式');
    });

    it('should pass when requireApproval is false', async () => {
      const lenientGate = new ReviewGate({ requireApproval: false });

      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: 'abc123 Initial commit' });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: '' });
        });

      const result = await lenientGate.check(baseContext);

      expect(result.passed).toBe(true);
    });

    it('should detect unpushed commits', async () => {
      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: 'abc123 Initial commit' });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: 'def456 New feature\nghi789 Bug fix' });
        });

      const result = await gate.check(baseContext);

      expect(result.details?.hasUnpushedCommits).toBe(true);
    });

    it('should handle git error', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Not a git repository'), null);
      });

      const result = await gate.check(baseContext);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Git 检查失败');
    });
  });

  describe('timing', () => {
    it('should include duration in result', async () => {
      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: 'abc123 Test' });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: '' });
        });

      const result = await gate.check(baseContext);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp', async () => {
      mockExec
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: 'abc123 Test' });
        })
        .mockImplementationOnce((cmd, opts, callback) => {
          callback(null, { stdout: '' });
        });

      const result = await gate.check(baseContext);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });
});
