/**
 * traces 命令测试
 */

import { tracesCommand } from '../traces';
import { getTraceCollector } from '../../../monitoring/traces';
import { createAnalyzer } from '../../../monitoring/trace-analyzer';

// Mock monitoring
jest.mock('../../../monitoring/traces', () => ({
  getTraceCollector: jest.fn(),
}));

jest.mock('../../../monitoring/trace-analyzer', () => ({
  createAnalyzer: jest.fn(),
}));

const mockGetTraceCollector = getTraceCollector as jest.MockedFunction<typeof getTraceCollector>;
const mockCreateAnalyzer = createAnalyzer as jest.MockedFunction<typeof createAnalyzer>;

describe('traces command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('tracesCommand', () => {
    it('应该显示帮助信息', async () => {
      await tracesCommand('', {});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    describe('stats subcommand', () => {
      it('应该显示统计信息', async () => {
        const mockCollector = {
          getStats: jest.fn().mockReturnValue({
            fileExists: true,
            fileSize: 1024,
            totalLines: 100,
            oldestTrace: Date.now() - 86400000,
            newestTrace: Date.now(),
          }),
        };
        mockGetTraceCollector.mockReturnValue(mockCollector as any);

        await tracesCommand('stats', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Statistics'));
      });

      it('应该输出 JSON 格式', async () => {
        const mockCollector = {
          getStats: jest.fn().mockReturnValue({
            fileExists: false,
            fileSize: 0,
            totalLines: 0,
          }),
        };
        mockGetTraceCollector.mockReturnValue(mockCollector as any);

        await tracesCommand('stats', { format: 'json' });
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('summary subcommand', () => {
      it('应该显示约束汇总', async () => {
        const mockAnalyzer = {
          analyzeRecent: jest.fn().mockReturnValue([
            {
              constraintId: 'test',
              level: 'iron_law',
              totalChecks: 10,
              passRate: 0.8,
              failRate: 0.1,
              bypassRate: 0.1,
              recentTrend: 'stable',
            },
          ]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('summary', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Summaries'));
      });

      it('应该处理无 traces 情况', async () => {
        const mockAnalyzer = {
          analyzeRecent: jest.fn().mockReturnValue([]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('summary', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No traces'));
      });

      it('应该过滤特定约束', async () => {
        const mockAnalyzer = {
          analyzeConstraint: jest.fn().mockReturnValue([]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('summary', { constraintId: 'test' });
        expect(mockAnalyzer.analyzeConstraint).toHaveBeenCalledWith('test');
      });
    });

    describe('anomalies subcommand', () => {
      it('应该显示异常', async () => {
        const mockAnalyzer = {
          runDailyAnomalyCheck: jest.fn().mockReturnValue([
            {
              type: 'high_failure_rate',
              constraintId: 'test',
              message: 'High failure rate',
              suggestedAction: 'Investigate',
            },
          ]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('anomalies', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Anomalies'));
      });

      it('应该处理无异常情况', async () => {
        const mockAnalyzer = {
          runDailyAnomalyCheck: jest.fn().mockReturnValue([]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('anomalies', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No anomalies'));
      });
    });

    describe('report subcommand', () => {
      it('应该生成报告', async () => {
        const mockAnalyzer = {
          analyzeRecent: jest.fn().mockReturnValue([]),
          detectAnomalies: jest.fn().mockReturnValue([]),
          generateReport: jest.fn().mockReturnValue('Report content'),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('report', {});
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('应该输出 JSON 格式', async () => {
        const mockAnalyzer = {
          analyzeRecent: jest.fn().mockReturnValue([]),
          detectAnomalies: jest.fn().mockReturnValue([]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await tracesCommand('report', { format: 'json' });
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('clean subcommand', () => {
      it('应该清理旧文件', async () => {
        const mockCollector = {
          cleanupOldFiles: jest.fn().mockReturnValue(5),
        };
        mockGetTraceCollector.mockReturnValue(mockCollector as any);

        await tracesCommand('clean', { maxAgeDays: 30 });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cleaned'));
      });
    });
  });
});
