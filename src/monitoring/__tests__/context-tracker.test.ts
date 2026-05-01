/**
 * ContextTracker 测试
 */

import { ContextTracker } from '../context-tracker';
import * as fs from 'fs';
import type { ContextUsageSnapshot } from '../../context/types';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue(''),
  appendFileSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 0 }),
  renameSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

function makeSnapshot(overrides?: Partial<ContextUsageSnapshot>): ContextUsageSnapshot {
  return {
    timestamp: new Date().toISOString(),
    totalTokens: 1000,
    breakdown: {
      systemPrompt: 200,
      messages: 300,
      toolOutputs: 200,
      knowledge: 200,
      other: 100,
    },
    truncatedItems: [],
    offloadedItems: [],
    compactionTriggered: false,
    ...overrides,
  };
}

describe('ContextTracker', () => {
  let tracker: ContextTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-setup default mock return values after clearAllMocks
    (mockFs.existsSync as jest.Mock).mockReturnValue(true);
    (mockFs.readFileSync as jest.Mock).mockReturnValue('');
    (mockFs.statSync as jest.Mock).mockReturnValue({ size: 0 });
    tracker = new ContextTracker('/test');
  });

  describe('record', () => {
    it('应该追加快照到日志文件', () => {
      tracker.record(makeSnapshot());
      expect(mockFs.appendFileSync).toHaveBeenCalled();
    });

    it('应该创建目录当不存在', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      tracker.record(makeSnapshot());
      expect(mockFs.mkdirSync).toHaveBeenCalled();
      expect(mockFs.appendFileSync).toHaveBeenCalled();
    });

    it('应该轮转文件当超过大小限制', () => {
      (mockFs.existsSync as jest.Mock)
        .mockReturnValueOnce(true)   // dir exists
        .mockReturnValueOnce(true);  // log file exists
      (mockFs.statSync as jest.Mock).mockReturnValue({ size: 20 * 1024 * 1024 });
      tracker.record(makeSnapshot());
      expect(mockFs.renameSync).toHaveBeenCalled();
    });
  });

  describe('getRecent', () => {
    it('应该返回最近 N 条记录', () => {
      const snapshots = [
        makeSnapshot({ totalTokens: 100 }),
        makeSnapshot({ totalTokens: 200 }),
        makeSnapshot({ totalTokens: 300 }),
      ];
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        snapshots.map(s => JSON.stringify(s)).join('\n')
      );

      const recent = tracker.getRecent(2);
      expect(recent.length).toBe(2);
      expect(recent[0].totalTokens).toBe(200);
      expect(recent[1].totalTokens).toBe(300);
    });

    it('应该返回空数组当文件不存在', () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      const recent = tracker.getRecent(10);
      expect(recent).toEqual([]);
    });

    it('应该跳过无效 JSON 行', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        'invalid\n' + JSON.stringify(makeSnapshot()) + '\n'
      );
      const recent = tracker.getRecent(10);
      expect(recent.length).toBe(1);
    });
  });

  describe('getAverages', () => {
    it('应该计算均值', () => {
      const snapshots = [
        makeSnapshot({ totalTokens: 1000, compactionTriggered: false, breakdown: { systemPrompt: 200, messages: 300, toolOutputs: 200, knowledge: 200, other: 100 } }),
        makeSnapshot({ totalTokens: 2000, compactionTriggered: true, breakdown: { systemPrompt: 400, messages: 600, toolOutputs: 400, knowledge: 400, other: 200 } }),
      ];
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        snapshots.map(s => JSON.stringify(s)).join('\n')
      );

      const avg = tracker.getAverages();
      expect(avg.avgTokens).toBe(1500);
      expect(avg.avgCompactionRate).toBe(0.5);
    });

    it('应该返回零当无记录', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue('');
      const avg = tracker.getAverages();
      expect(avg.avgTokens).toBe(0);
    });
  });

  describe('detectIssues', () => {
    it('应该检测工具输出占比过高', () => {
      const snapshots = Array(10).fill(null).map(() =>
        makeSnapshot({
          totalTokens: 1000,
          breakdown: { systemPrompt: 100, messages: 100, toolOutputs: 600, knowledge: 100, other: 100 },
        })
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        snapshots.map(s => JSON.stringify(s)).join('\n')
      );

      const issues = tracker.detectIssues();
      expect(issues.some(i => i.includes('工具输出占比'))).toBe(true);
    });

    it('应该检测压缩频率过高', () => {
      const snapshots = Array(10).fill(null).map(() =>
        makeSnapshot({ compactionTriggered: true })
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        snapshots.map(s => JSON.stringify(s)).join('\n')
      );

      const issues = tracker.detectIssues();
      expect(issues.some(i => i.includes('压缩触发频率'))).toBe(true);
    });

    it('应该返回空数组当无问题', () => {
      const snapshots = Array(10).fill(null).map(() =>
        makeSnapshot({
          totalTokens: 1000,
          compactionTriggered: false,
          breakdown: { systemPrompt: 200, messages: 300, toolOutputs: 100, knowledge: 200, other: 200 },
          truncatedItems: [],
        })
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        snapshots.map(s => JSON.stringify(s)).join('\n')
      );

      const issues = tracker.detectIssues();
      expect(issues.length).toBe(0);
    });
  });
});
