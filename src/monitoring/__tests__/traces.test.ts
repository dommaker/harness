/**
 * TraceCollector 测试（简化版）
 */

import { TraceCollector, getTraceCollector, configureTraceCollector } from '../traces';
import * as fs from 'fs';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 100 }),
  renameSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  unlinkSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('TraceCollector', () => {
  let collector: TraceCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 100 } as any);
    collector = new TraceCollector();
  });

  describe('constructor', () => {
    it('should create trace directory if not exists', () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      new TraceCollector();
      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });

    it('should be disabled when enabled=false', () => {
      const disabledCollector = new TraceCollector({ enabled: false });
      disabledCollector.record({
        constraintId: 'test',
        level: 'iron_law',
        timestamp: Date.now(),
        result: 'pass',
      });
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('record()', () => {
    it('should append trace to file', () => {
      collector.record({
        constraintId: 'test',
        level: 'iron_law',
        timestamp: Date.now(),
        result: 'pass',
      });
      expect(mockFs.appendFileSync).toHaveBeenCalled();
    });
  });

  describe('recordPass()', () => {
    it('should record pass trace', () => {
      collector.recordPass('test_constraint', 'iron_law');
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = JSON.parse(call[1] as string);
      expect(content.result).toBe('pass');
    });
  });

  describe('recordFail()', () => {
    it('should record fail trace', () => {
      collector.recordFail('test_constraint', 'iron_law');
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = JSON.parse(call[1] as string);
      expect(content.result).toBe('fail');
    });
  });

  describe('recordBypass()', () => {
    it('should record bypass trace', () => {
      collector.recordBypass('test', 'guideline', 'Emergency');
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = JSON.parse(call[1] as string);
      expect(content.result).toBe('bypassed');
      expect(content.bypassReason).toBe('Emergency');
    });
  });

  describe('read()', () => {
    it('should return empty array if file not exists', () => {
      mockFs.existsSync.mockReturnValueOnce(true);
      mockFs.existsSync.mockReturnValueOnce(false);
      const c = new TraceCollector();
      const traces = c.read();
      expect(traces).toEqual([]);
    });

    it('should parse all traces from file', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        '{"constraintId":"a","level":"iron_law","timestamp":100,"result":"pass"}\n' +
        '{"constraintId":"b","level":"guideline","timestamp":200,"result":"fail"}\n'
      );
      const traces = collector.read();
      expect(traces.length).toBe(2);
    });

    it('should apply constraintId filter', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        '{"constraintId":"a","level":"iron_law","timestamp":100,"result":"pass"}\n' +
        '{"constraintId":"b","level":"guideline","timestamp":200,"result":"fail"}\n'
      );
      const traces = collector.read({ constraintId: 'a' });
      expect(traces.length).toBe(1);
    });

    it('should apply level filter', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        '{"constraintId":"a","level":"iron_law","timestamp":100,"result":"pass"}\n' +
        '{"constraintId":"b","level":"guideline","timestamp":200,"result":"fail"}\n'
      );
      const traces = collector.read({ level: 'guideline' });
      expect(traces.length).toBe(1);
    });
  });

  describe('readRecent()', () => {
    it('should read recent traces', () => {
      const now = Date.now();
      mockFs.readFileSync.mockReturnValueOnce(
        `{"constraintId":"new","level":"iron_law","timestamp":${now - 1000},"result":"pass"}\n`
      );
      const traces = collector.readRecent(1);
      expect(traces.length).toBe(1);
    });
  });

  describe('readByConstraint()', () => {
    it('should read by constraint', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        '{"constraintId":"a","level":"iron_law","timestamp":100,"result":"pass"}\n'
      );
      const traces = collector.readByConstraint('a');
      expect(traces.length).toBe(1);
    });
  });

  describe('rotateFile()', () => {
    it('should rotate when size exceeded', () => {
      mockFs.statSync.mockReturnValueOnce({ size: 11 * 1024 * 1024 } as any);
      collector.record({
        constraintId: 'test',
        level: 'iron_law',
        timestamp: Date.now(),
        result: 'pass',
      });
      expect(mockFs.renameSync).toHaveBeenCalled();
    });
  });

  describe('getStats()', () => {
    it('should return stats', () => {
      mockFs.existsSync.mockReturnValueOnce(true);
      mockFs.readFileSync.mockReturnValueOnce(
        '{"constraintId":"a","level":"iron_law","timestamp":100,"result":"pass"}\n'
      );
      mockFs.statSync.mockReturnValueOnce({ size: 1024 } as any);
      const stats = collector.getStats();
      expect(stats.fileExists).toBe(true);
    });
  });
});

describe('getTraceCollector()', () => {
  it('should return global collector', () => {
    const c1 = getTraceCollector();
    const c2 = getTraceCollector();
    expect(c1).toBe(c2);
  });
});

describe('configureTraceCollector()', () => {
  it('should create new global collector', () => {
    configureTraceCollector({ traceFile: '/custom/traces.log' });
    const c = getTraceCollector();
    expect(c).toBeDefined();
  });
});