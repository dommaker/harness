/**
 * flow 命令测试
 */

import { flow } from '../flow';
import * as fs from 'fs';
import * as readline from 'readline';
import { TraceCollector } from '../../../monitoring/traces';
import { TraceAnalyzer } from '../../../monitoring/trace-analyzer';
import { ConstraintDoctor } from '../../../monitoring/constraint-doctor';
import { ConstraintEvolver } from '../../../monitoring/constraint-evolver';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue(''),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock readline
jest.mock('readline', () => ({
  createInterface: jest.fn().mockReturnValue({
    question: jest.fn(),
    close: jest.fn(),
  }),
}));

// Mock monitoring modules
jest.mock('../../../monitoring/traces', () => ({
  TraceCollector: jest.fn(),
}));

jest.mock('../../../monitoring/trace-analyzer', () => ({
  TraceAnalyzer: jest.fn(),
}));

jest.mock('../../../monitoring/constraint-doctor', () => ({
  ConstraintDoctor: jest.fn(),
}));

jest.mock('../../../monitoring/constraint-evolver', () => ({
  ConstraintEvolver: jest.fn(),
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
const MockConstraintDoctor = ConstraintDoctor as jest.MockedClass<typeof ConstraintDoctor>;
const MockConstraintEvolver = ConstraintEvolver as jest.MockedClass<typeof ConstraintEvolver>;

describe('flow command', () => {
  let consoleSpy: jest.SpyInstance;
  let mockRl: { question: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    process.exitCode = 0;

    mockRl = {
      question: jest.fn((q: string, cb: (a: string) => void) => cb('y')),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);
    
    // Reset fs mocks
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue('');
    mockFs.mkdirSync.mockReturnValue('');
    mockFs.writeFileSync.mockReturnValue(undefined as any);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('flow', () => {
    it('应该跳过无 trace 记录情况', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await flow({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('暂无 Trace'));
    });

    it('应该跳过无异常情况', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{}');

      const mockCollector = {
        read: jest.fn().mockReturnValue([]),
      };
      const mockAnalyzer = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceCollector as any).mockImplementation(() => mockCollector);
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyzer);

      await flow({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未发现异常'));
    });

    it('应该运行完整流程', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ constraintId: 'test' }));

      const mockCollector = {
        read: jest.fn().mockReturnValue([]),
      };
      const mockAnalyzer = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'test', level: 'iron_law', passRate: 0.3 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue([
          { constraintId: 'test', type: 'high_failure_rate' },
        ]),
      };
      (MockTraceCollector as any).mockImplementation(() => mockCollector);
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyzer);

      const mockDoctor = {
        diagnose: jest.fn().mockResolvedValue({
          anomalyId: 'test-anomaly',
          constraintId: 'test',
          rootCause: { primary: 'test' },
          impact: { severity: 'high' },
        }),
      };
      (MockConstraintDoctor as any).mockImplementation(() => mockDoctor);

      const mockEvolver = {
        propose: jest.fn().mockResolvedValue({
          constraintId: 'test',
          type: 'adjust_threshold',
          risk: { level: 'low' },
        }),
      };
      (MockConstraintEvolver as any).mockImplementation(() => mockEvolver);

      await flow({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('流程完成'));
    });

    it('应该支持从诊断步骤开始', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ constraintId: 'test' }));

      const mockCollector = {
        read: jest.fn().mockReturnValue([]),
      };
      const mockAnalyzer = {
        summarize: jest.fn().mockReturnValue([]),
        detectAnomalies: jest.fn().mockReturnValue([]),
      };
      (MockTraceCollector as any).mockImplementation(() => mockCollector);
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyzer);

      await flow({ from: 'diagnose' });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('应该自动应用低风险提案', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ constraintId: 'test' }));

      const mockCollector = {
        read: jest.fn().mockReturnValue([]),
      };
      const mockAnalyzer = {
        summarize: jest.fn().mockReturnValue([
          { constraintId: 'test', level: 'iron_law', passRate: 0.3 },
        ]),
        detectAnomalies: jest.fn().mockReturnValue([
          { constraintId: 'test', type: 'high_failure_rate' },
        ]),
      };
      (MockTraceCollector as any).mockImplementation(() => mockCollector);
      (MockTraceAnalyzer as any).mockImplementation(() => mockAnalyzer);

      const mockDoctor = {
        diagnose: jest.fn().mockResolvedValue({
          anomalyId: 'test-anomaly',
          constraintId: 'test',
          rootCause: { primary: 'test' },
          impact: { severity: 'high' },
        }),
      };
      (MockConstraintDoctor as any).mockImplementation(() => mockDoctor);

      const mockEvolver = {
        propose: jest.fn().mockResolvedValue({
          constraintId: 'test',
          type: 'adjust_threshold',
          risk: { level: 'low' },
        }),
      };
      (MockConstraintEvolver as any).mockImplementation(() => mockEvolver);

      mockRl.question
        .mockImplementationOnce((q: string, cb: (a: string) => void) => cb('y'))
        .mockImplementationOnce((q: string, cb: (a: string) => void) => cb('y'));

      await flow({ autoApply: true });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('自动应用'));
    });
  });
});