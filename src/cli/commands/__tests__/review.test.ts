/**
 * review 命令测试
 */

import { review, reviewStatus } from '../review';
import { execAsync } from '../../../utils/exec';
import { ReviewGate } from '../../../gates/review';

jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn(),
}));

jest.mock('../../../gates/review', () => ({
  ReviewGate: jest.fn().mockImplementation(() => ({
    check: jest.fn(),
  })),
}));

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
}));

const mockExec = execAsync as jest.MockedFunction<typeof execAsync>;
const MockGate = ReviewGate as jest.MockedClass<typeof ReviewGate>;

describe('review command', () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('review', () => {
    it('should print success when check passes', async () => {
      mockExec.mockResolvedValue({ stdout: 'main\n', stderr: '' });
      const mockCheck = jest.fn().mockResolvedValue({
        passed: true,
        message: 'ok',
        details: { approvals: 2, changesRequested: 0 },
      });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await review({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('代码审查门控检查通过'));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should print failure and exit 1 when check fails', async () => {
      mockExec.mockResolvedValue({ stdout: 'main\n', stderr: '' });
      const mockCheck = jest.fn().mockResolvedValue({
        passed: false,
        message: 'needs approval',
        details: { suggestion: 'Request review from a teammate' },
      });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await review({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('代码审查门控检查失败'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle errors and exit 1', async () => {
      mockExec.mockResolvedValue({ stdout: 'main\n', stderr: '' });
      const mockCheck = jest.fn().mockRejectedValue(new Error('gate error'));
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await review({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('代码审查门控检查出错'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should show hint when not in a git repo', async () => {
      mockExec.mockRejectedValue(new Error('not a git repository'));

      await review({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('需要在 Git 仓库中运行'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should parse allowedReviewers from comma-separated string', async () => {
      mockExec.mockResolvedValue({ stdout: 'main\n', stderr: '' });
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await review({ allowedReviewers: 'alice, bob, charlie' });

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedReviewers: ['alice', 'bob', 'charlie'],
        }),
      );
    });
  });

  describe('reviewStatus', () => {
    it('should display PR info', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: 'feature-branch\n', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            number: 42,
            title: 'Add feature',
            state: 'OPEN',
            reviewDecision: 'APPROVED',
            reviews: [{ author: { login: 'alice' }, state: 'APPROVED' }],
          }),
          stderr: '',
        });

      await reviewStatus({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PR #42'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('APPROVED'));
    });

    it('should handle no PR found', async () => {
      mockExec
        .mockResolvedValueOnce({ stdout: 'feature-branch\n', stderr: '' })
        .mockRejectedValueOnce(new Error('no PR'));

      await reviewStatus({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未找到关联的 PR'));
    });

    it('should handle git errors', async () => {
      mockExec.mockRejectedValue(new Error('not a git repository'));

      await reviewStatus({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('获取审查状态失败'));
    });
  });
});
