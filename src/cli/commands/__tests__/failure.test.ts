/**
 * failure CLI 命令测试
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as path from 'path';
import { FailureRecorder } from '../../../failure/recorder';
import { ErrorType, FailureLevel } from '../../../failure/types';
import type { FailureRecord } from '../../../failure/types';

// Mock FailureRecorder
jest.mock('../../../failure/recorder');

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('failure CLI commands', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-failure-cli');
  let mockRecorderInstance: {
    record: jest.Mock;
    getHistory: jest.Mock;
    getStats: jest.Mock;
    clear: jest.Mock;
  };

  const sampleRecords: FailureRecord[] = [
    { type: ErrorType.TEST_FAILED, level: FailureLevel.L1, message: 'Test 1 failed', timestamp: 1000 },
    { type: ErrorType.NETWORK_ERROR, level: FailureLevel.L2, message: 'Network error', timestamp: 2000 },
    { type: ErrorType.TEST_FAILED, level: FailureLevel.L3, message: 'Critical test fail', timestamp: 3000 },
  ];

  const sampleStats = {
    total: 3,
    byType: { TEST_FAILED: 2, NETWORK_ERROR: 1 },
    byLevel: { L1: 1, L2: 1, L3: 1 },
  };

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock instance methods
    mockRecorderInstance = {
      record: jest.fn().mockResolvedValue(undefined),
      getHistory: jest.fn().mockResolvedValue(sampleRecords),
      getStats: jest.fn().mockResolvedValue(sampleStats),
      clear: jest.fn().mockResolvedValue(undefined),
    };

    (FailureRecorder as jest.Mock).mockImplementation(() => mockRecorderInstance);
  });

  describe('failureList', () => {
    it('应该列出所有记录', async () => {
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir }, io);

      expect(io.outText()).toContain('失败记录');
      expect(io.outText()).toContain('TEST_FAILED');
    });

    it('应该按类型过滤', async () => {
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir, type: 'TEST_FAILED' }, io);

      expect(mockRecorderInstance.getHistory).toHaveBeenCalled();
    });

    it('应该按等级过滤', async () => {
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir, level: 'L1' }, io);

      expect(mockRecorderInstance.getHistory).toHaveBeenCalled();
    });

    it('应该限制返回数量', async () => {
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir, limit: 2 }, io);

      expect(mockRecorderInstance.getHistory).toHaveBeenCalled();
    });

    it('空记录应该输出提示', async () => {
      mockRecorderInstance.getHistory.mockResolvedValue([]);
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir }, io);

      expect(io.outText()).toContain('没有失败记录');
    });

    it('--json 模式应该输出 JSON', async () => {
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir, json: true }, io);

      const jsonCall = io.outRecords().map(chunk => [chunk] as string[]).find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.total).toBe(3);
    });

    it('--json 模式空记录应该输出 total:0', async () => {
      mockRecorderInstance.getHistory.mockResolvedValue([]);
      const { failureList } = await import('../failure');
      await failureList({ projectPath: tempDir, json: true }, io);

      const jsonCall = io.outRecords().map(chunk => [chunk] as string[]).find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.total).toBe(0);
    });
  });

  describe('failureStats', () => {
    it('应该输出统计信息', async () => {
      const { failureStats } = await import('../failure');
      await failureStats({ projectPath: tempDir }, io);

      expect(io.outText()).toContain('失败统计');
      expect(io.outText()).toContain('TEST_FAILED');
    });

    it('--json 模式应该输出 JSON 统计', async () => {
      const { failureStats } = await import('../failure');
      await failureStats({ projectPath: tempDir, json: true }, io);

      const jsonCall = io.outRecords().map(chunk => [chunk] as string[]).find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.total).toBe(3);
    });

    it('空记录应该输出绿色提示', async () => {
      mockRecorderInstance.getStats.mockResolvedValue({ total: 0, byType: {}, byLevel: {} });
      const { failureStats } = await import('../failure');
      await failureStats({ projectPath: tempDir }, io);

      expect(io.outText()).toContain('没有失败记录');
    });

    it('--json 模式空记录应该输出空统计', async () => {
      mockRecorderInstance.getStats.mockResolvedValue({ total: 0, byType: {}, byLevel: {} });
      const { failureStats } = await import('../failure');
      await failureStats({ projectPath: tempDir, json: true }, io);

      const jsonCall = io.outRecords().map(chunk => [chunk] as string[]).find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.total).toBe(0);
    });
  });

  describe('failureClear', () => {
    it('应该清空记录并输出结果', async () => {
      const { failureClear } = await import('../failure');
      await failureClear({ projectPath: tempDir }, io);

      expect(mockRecorderInstance.clear).toHaveBeenCalled();
      expect(io.outText()).toContain('已清空');
    });

    it('--json 模式应该输出清空的记录数', async () => {
      const { failureClear } = await import('../failure');
      await failureClear({ projectPath: tempDir, json: true }, io);

      const jsonCall = io.outRecords().map(chunk => [chunk] as string[]).find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.cleared).toBe(3);
    });
  });
});
