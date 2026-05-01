/**
 * status 命令测试
 */

import { status } from '../status';
import * as fs from 'fs';
import { TraceCollector } from '../../../monitoring/traces';
import { TraceAnalyzer } from '../../../monitoring/trace-analyzer';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock TraceCollector
jest.mock('../../../monitoring/traces', () => ({
  TraceCollector: jest.fn().mockImplementation(() => ({
    record: jest.fn(),
    read: jest.fn().mockReturnValue([]),
  })),
}));

// Mock TraceAnalyzer
jest.mock('../../../monitoring/trace-analyzer', () => ({
  TraceAnalyzer: jest.fn().mockImplementation(() => ({
    summarize: jest.fn().mockReturnValue([]),
    detectAnomalies: jest.fn().mockReturnValue([]),
  })),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockTraceCollector = TraceCollector as jest.MockedClass<typeof TraceCollector>;
const MockTraceAnalyzer = TraceAnalyzer as jest.MockedClass<typeof TraceAnalyzer>;

describe('status command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.writeFileSync.mockImplementation();
    mockFs.mkdirSync.mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('未初始化情况', () => {
    it('应该显示未初始化提示', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未初始化'));
    });
  });

  describe('无 trace 记录', () => {
    it('应该显示暂无记录提示', async () => {
      // harness dir 存在，但 traces 文件不存在
      mockFs.existsSync
        .mockReturnValueOnce(true) // .harness dir
        .mockReturnValueOnce(false); // traces file

      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('暂无 Trace'));
    });
  });

  describe('正常状态显示', () => {
    it('应该显示记录数', async () => {
      const mockTraces = [
        { constraintId: 'test1', level: 'iron_law', result: 'pass' },
        { constraintId: 'test2', level: 'guideline', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummarize = jest.fn().mockReturnValue([
        { constraintId: 'test1', level: 'iron_law', passRate: 1, totalChecks: 1, bypassRate: 0 },
      ]);
      const mockAnalyze = {
        summarize: mockSummarize,
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('应该显示 Iron Laws 统计', async () => {
      const mockTraces = [
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummarize = jest.fn().mockReturnValue([
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', passRate: 1, totalChecks: 5, bypassRate: 0 },
      ]);
      const mockAnalyze = {
        summarize: mockSummarize,
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ detail: true });
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('异常检测', () => {
    it('应该显示异常列表', async () => {
      const mockTraces = [
        { constraintId: 'test1', level: 'iron_law', result: 'fail' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockAnomalies = [
        { constraintId: 'test1', type: 'high_failure_rate', current: 0.8, threshold: 0.5 },
      ];
      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'test1', level: 'iron_law', passRate: 0.2, totalChecks: 5, bypassRate: 0 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue(mockAnomalies),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ anomalies: true });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('异常'));
    });
  });

  describe('详细模式', () => {
    it('应该显示详细统计', async () => {
      const mockTraces = [
        { constraintId: 'test1', level: 'iron_law', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummarize = jest.fn().mockReturnValue([
        { constraintId: 'test1', level: 'iron_law', passRate: 0.8, totalChecks: 10, bypassRate: 0.1 },
      ]);
      const mockAnalyze = {
        summarize: mockSummarize,
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ detail: true });
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('状态文件更新', () => {
    it('应该更新 .state.json', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test","level":"iron_law"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('Guidelines 统计', () => {
    it('应该显示 Guidelines 统计', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'test_guide', level: 'guideline', passRate: 0.9, totalChecks: 10, bypassRate: 0 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Guidelines'));
    });

    it('应该显示 Tips 统计', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'test_tip', level: 'tip', passRate: 1, totalChecks: 5, bypassRate: 0 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Tips'));
    });
  });

  describe('异常模式', () => {
    it('应该显示未发现异常当无异常', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ anomalies: true });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未发现异常'));
    });

    it('应该显示异常详情', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([
          { constraintId: 'test', type: 'high_failure_rate', data: { currentRate: 0.8, threshold: 0.5 } },
        ]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ anomalies: true });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('异常'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('下一步建议'));
    });
  });

  describe('建议', () => {
    it('应该显示良好建议当 trace >= 100', async () => {
      const traces = Array(100).fill('{"constraintId":"test"}').join('\n');
      mockFs.readFileSync.mockReturnValue(traces);

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('状态良好'));
    });

    it('应该显示积累数据建议当 trace < 100', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('继续积累数据'));
    });

    it('应该显示诊断建议当有异常', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([
          { constraintId: 'test', type: 'high_failure_rate' },
        ]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('harness flow'));
    });
  });

  describe('详细模式', () => {
    it('应该显示 Guidelines 详细统计', async () => {
      mockFs.readFileSync.mockReturnValue('{"constraintId":"test"}');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'test_guide', level: 'guideline', passRate: 0.6, totalChecks: 10, bypassRate: 0.1 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ detail: true });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('检查:'));
    });
  });
});
