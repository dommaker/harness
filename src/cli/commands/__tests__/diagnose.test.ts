/**
 * diagnose 命令测试
 */

import { diagnoseCommand } from '../diagnose';
import * as fs from 'fs';
import { getTraceCollector } from '../../../monitoring/traces';
import { createAnalyzer } from '../../../monitoring/trace-analyzer';
import { createDoctor } from '../../../monitoring/constraint-doctor';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
}));

// Mock monitoring
jest.mock('../../../monitoring/traces', () => ({
  getTraceCollector: jest.fn(),
}));

jest.mock('../../../monitoring/trace-analyzer', () => ({
  createAnalyzer: jest.fn(),
}));

jest.mock('../../../monitoring/constraint-doctor', () => ({
  createDoctor: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGetTraceCollector = getTraceCollector as jest.MockedFunction<typeof getTraceCollector>;
const mockCreateAnalyzer = createAnalyzer as jest.MockedFunction<typeof createAnalyzer>;
const mockCreateDoctor = createDoctor as jest.MockedFunction<typeof createDoctor>;

describe('diagnose command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('diagnoseCommand', () => {
    it('应该显示帮助信息', async () => {
      await diagnoseCommand('', {});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    describe('run subcommand', () => {
      it('应该运行诊断', async () => {
        const mockAnalyzer = {
          runDailyAnomalyCheck: jest.fn().mockReturnValue([
            { constraintId: 'test', type: 'high_failure_rate' },
          ]),
        };
        const mockDoctor = {
          setData: jest.fn(),
          diagnose: jest.fn().mockResolvedValue({
            anomalyId: 'test-anomaly',
            constraintId: 'test',
            needsChange: false,
            urgency: 'low',
          }),
          generateReport: jest.fn().mockReturnValue('Report'),
          saveDiagnosis: jest.fn(),
        };
        const mockCollector = {
          readRecent: jest.fn().mockReturnValue([]),
        };

        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);
        mockGetTraceCollector.mockReturnValue(mockCollector as any);

        await diagnoseCommand('run', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('anomalies'));
      });

      it('应该处理无异常情况', async () => {
        const mockAnalyzer = {
          runDailyAnomalyCheck: jest.fn().mockReturnValue([]),
        };
        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);

        await diagnoseCommand('run', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No anomalies'));
      });

      it('应该过滤特定约束', async () => {
        const mockAnalyzer = {
          runDailyAnomalyCheck: jest.fn().mockReturnValue([
            { constraintId: 'test1', type: 'high_failure_rate' },
            { constraintId: 'test2', type: 'high_failure_rate' },
          ]),
        };
        const mockDoctor = {
          setData: jest.fn(),
          diagnose: jest.fn().mockResolvedValue({
            anomalyId: 'test-anomaly',
            constraintId: 'test1',
            needsChange: false,
            urgency: 'low',
          }),
          generateReport: jest.fn().mockReturnValue('Report'),
        };
        const mockCollector = {
          readRecent: jest.fn().mockReturnValue([]),
        };

        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);
        mockGetTraceCollector.mockReturnValue(mockCollector as any);

        await diagnoseCommand('run', { constraintId: 'test1' });
        expect(mockDoctor.diagnose).toHaveBeenCalledTimes(1);
      });

      it('应该输出 JSON 格式', async () => {
        const mockAnalyzer = {
          runDailyAnomalyCheck: jest.fn().mockReturnValue([
            { constraintId: 'test', type: 'high_failure_rate' },
          ]),
        };
        const mockDoctor = {
          setData: jest.fn(),
          diagnose: jest.fn().mockResolvedValue({
            anomalyId: 'test-anomaly',
            constraintId: 'test',
            needsChange: false,
            urgency: 'low',
          }),
          generateReport: jest.fn().mockReturnValue('Report'),
        };
        const mockCollector = {
          readRecent: jest.fn().mockReturnValue([]),
        };

        mockCreateAnalyzer.mockReturnValue(mockAnalyzer as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);
        mockGetTraceCollector.mockReturnValue(mockCollector as any);

        await diagnoseCommand('run', { format: 'json' });
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('show subcommand', () => {
      it('应该显示特定诊断', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test-anomaly',
          constraintId: 'test',
          needsChange: false,
          urgency: 'low',
        }));

        const mockDoctor = {
          loadDiagnosis: jest.fn().mockReturnValue({
            anomalyId: 'test-anomaly',
            constraintId: 'test',
            needsChange: false,
            urgency: 'low',
          }),
          generateReport: jest.fn().mockReturnValue('Report'),
        };
        mockCreateDoctor.mockReturnValue(mockDoctor as any);

        await diagnoseCommand('show', { anomalyId: 'test-anomaly' });
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('应该提示缺少 anomalyId', async () => {
        await diagnoseCommand('show', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('specify'));
      });

      it('应该处理找不到诊断', async () => {
        mockFs.existsSync.mockReturnValue(false);

        await diagnoseCommand('show', { anomalyId: 'missing' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      });
    });

    describe('list subcommand', () => {
      it('应该列出所有诊断', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue(['diagnosis1.json', 'diagnosis2.json'] as any);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test',
          constraintId: 'test',
          needsChange: false,
          urgency: 'low',
        }));

        await diagnoseCommand('list', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Diagnosis List'));
      });

      it('应该处理无诊断目录', async () => {
        mockFs.existsSync.mockReturnValue(false);

        await diagnoseCommand('list', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No diagnoses found'));
      });

      it('应该处理空诊断目录', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue([]);

        await diagnoseCommand('list', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No diagnoses found'));
      });
    });
  });
});