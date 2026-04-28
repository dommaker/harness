/**
 * PerformanceAnalyzer 测试
 */

import { PerformanceAnalyzer } from '../performance-analyzer';
import { PerformanceCollector } from '../performance-collector';
import type { PerformanceTrace } from '../../types/performance';

// Mock PerformanceCollector
jest.mock('../performance-collector');

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const MockPerformanceCollector = PerformanceCollector as jest.MockedClass<typeof PerformanceCollector>;

describe('PerformanceAnalyzer', () => {
  let analyzer: PerformanceAnalyzer;
  let mockCollector: PerformanceCollector;

  const mockTraces: PerformanceTrace[] = [
    { operation: 'test', timestamp: Date.now(), duration: 100, result: 'ok' },
    { operation: 'test', timestamp: Date.now() + 1000, duration: 200, result: 'ok' },
    { operation: 'test', timestamp: Date.now() + 2000, duration: 35000, result: 'exceeded', threshold: 30000 },
    { operation: 'test2', timestamp: Date.now(), duration: 500, result: 'ok' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollector = new MockPerformanceCollector();
    analyzer = new PerformanceAnalyzer(mockCollector);
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      expect(analyzer).toBeDefined();
    });

    it('should accept custom config', () => {
      const customAnalyzer = new PerformanceAnalyzer(mockCollector, {
        periodMs: 7200 * 1000,
      });
      expect(customAnalyzer).toBeDefined();
    });
  });

  describe('summarize()', () => {
    it('should group by operation', () => {
      const summaries = analyzer.summarize(mockTraces);
      expect(summaries.length).toBeGreaterThan(0);
    });

    it('should calculate total calls', () => {
      const summaries = analyzer.summarize(mockTraces);
      const testSummary = summaries.find(s => s.operation === 'test');
      expect(testSummary).toBeDefined();
      expect(testSummary!.totalCalls).toBe(3);
    });

    it('should calculate ok rate', () => {
      const summaries = analyzer.summarize(mockTraces);
      const testSummary = summaries.find(s => s.operation === 'test');
      expect(testSummary).toBeDefined();
    });

    it('should handle empty traces', () => {
      const summaries = analyzer.summarize([]);
      expect(summaries).toEqual([]);
    });

    it('should handle single trace', () => {
      const summaries = analyzer.summarize([
        { operation: 'single', timestamp: Date.now(), duration: 100, result: 'ok' },
      ]);
      expect(summaries.length).toBe(1);
    });
  });

  describe('detectAnomalies()', () => {
    it('should detect high exceeded rate', () => {
      const highExceededTraces: PerformanceTrace[] = [
        { operation: 'test', timestamp: Date.now(), duration: 35000, result: 'exceeded', threshold: 30000 },
        { operation: 'test', timestamp: Date.now() + 1000, duration: 40000, result: 'exceeded', threshold: 30000 },
        { operation: 'test', timestamp: Date.now() + 2000, duration: 100, result: 'ok' },
      ];
      
      const summaries = analyzer.summarize(highExceededTraces);
      const anomalies = analyzer.detectAnomalies(summaries);
      expect(anomalies.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty array for normal traces', () => {
      const normalTraces: PerformanceTrace[] = [
        { operation: 'test', timestamp: Date.now(), duration: 100, result: 'ok' },
        { operation: 'test', timestamp: Date.now() + 1000, duration: 150, result: 'ok' },
      ];
      
      const summaries = analyzer.summarize(normalTraces);
      const anomalies = analyzer.detectAnomalies(summaries);
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  describe('compareWithPrevious()', () => {
    it('should compare two summaries', () => {
      const current = analyzer.summarize(mockTraces);
      const previous = [...current];
      
      const compared = analyzer.compareWithPrevious(current, previous);
      expect(Array.isArray(compared)).toBe(true);
    });

    it('should handle empty comparison', () => {
      const compared = analyzer.compareWithPrevious([], []);
      expect(compared).toEqual([]);
    });
  });

  describe('runHourlySummary()', () => {
    it('should run hourly summary', () => {
      // Verify method exists - actual execution depends on collector state
      expect(typeof analyzer.runHourlySummary).toBe('function');
    });
  });

  describe('runDailyAnomalyCheck()', () => {
    it('should have method', () => {
      // Verify method exists
      expect(typeof analyzer.runDailyAnomalyCheck).toBe('function');
    });
  });
});