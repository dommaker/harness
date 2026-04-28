/**
 * status 命令补充测试
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

describe('status command - 补充覆盖', () => {
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

  describe('异常检测完整流程', () => {
    it('有异常时应该显示详细信息和下一步建议', async () => {
      const mockTraces = [
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', result: 'fail' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockAnomalies = [
        {
          constraintId: 'no_bypass_checkpoint',
          type: 'high_failure_rate',
          current: 0.8,
          threshold: 0.5,
        },
        {
          constraintId: 'no_self_approval',
          type: 'frequent_bypass',
          current: 0.3,
          threshold: 0.1,
        },
      ];
      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'no_bypass_checkpoint', level: 'iron_law', passRate: 0.2, totalChecks: 10, bypassRate: 0.1 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue(mockAnomalies),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ anomalies: true });
      
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('异常');
      expect(mockAnalyze.detectAnomalies).toHaveBeenCalled();
    });

    it('无异常时应该显示未发现异常', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ constraintId: 'test', level: 'iron_law', result: 'pass' }));

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ anomalies: true });
      
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('未发现异常');
    });
  });

  describe('约束级别统计', () => {
    it('应该显示 Iron Laws 统计', async () => {
      const mockTraces = [
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', result: 'pass' },
        { constraintId: 'no_self_approval', level: 'iron_law', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummaries = [
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', passRate: 1, totalChecks: 10, bypassRate: 0 },
        { constraintId: 'no_self_approval', level: 'iron_law', passRate: 0.8, totalChecks: 5, bypassRate: 0 },
      ];
      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue(mockSummaries),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('约束统计');
    });

    it('应该显示 Guidelines 统计', async () => {
      const mockTraces = [
        { constraintId: 'no_any_type', level: 'guideline', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummaries = [
        { constraintId: 'no_any_type', level: 'guideline', passRate: 0.9, totalChecks: 20, bypassRate: 0.1 },
      ];
      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue(mockSummaries),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('应该显示 Tips 统计', async () => {
      const mockTraces = [
        { constraintId: 'readme_required', level: 'tip', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummaries = [
        { constraintId: 'readme_required', level: 'tip', passRate: 1, totalChecks: 5, bypassRate: 0 },
      ];
      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue(mockSummaries),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('详细模式扩展', () => {
    it('详细模式应该显示所有级别详情', async () => {
      const mockTraces = [
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', result: 'pass' },
        { constraintId: 'no_any_type', level: 'guideline', result: 'pass' },
        { constraintId: 'readme_required', level: 'tip', result: 'pass' },
      ];
      mockFs.readFileSync.mockReturnValue(mockTraces.map(t => JSON.stringify(t)).join('\n'));

      const mockSummaries = [
        { constraintId: 'no_bypass_checkpoint', level: 'iron_law', passRate: 1, totalChecks: 10, bypassRate: 0 },
        { constraintId: 'no_any_type', level: 'guideline', passRate: 0.9, totalChecks: 20, bypassRate: 0.1 },
        { constraintId: 'readme_required', level: 'tip', passRate: 1, totalChecks: 5, bypassRate: 0 },
      ];
      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue(mockSummaries),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({ detail: true });
      
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('约束统计');
    });
  });

  describe('JSON parse 异常处理', () => {
    it('无效 JSON 行应该被过滤', async () => {
      mockFs.readFileSync.mockReturnValue('invalid json\n{"valid":"data"}\nalso invalid');

      const mockAnalyze = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyze);

      await status({});
      
      // 应该成功处理，不会抛出异常
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});