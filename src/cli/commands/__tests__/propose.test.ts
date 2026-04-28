/**
 * propose 命令测试
 */

import { proposeCommand } from '../propose';
import * as fs from 'fs';
import { createEvolver } from '../../../monitoring/constraint-evolver';
import { createDoctor } from '../../../monitoring/constraint-doctor';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock monitoring
jest.mock('../../../monitoring/constraint-evolver', () => ({
  createEvolver: jest.fn(),
}));

jest.mock('../../../monitoring/constraint-doctor', () => ({
  createDoctor: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const mockCreateEvolver = createEvolver as jest.MockedFunction<typeof createEvolver>;
const mockCreateDoctor = createDoctor as jest.MockedFunction<typeof createDoctor>;

describe('propose command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('proposeCommand', () => {
    it('应该显示帮助信息', async () => {
      await proposeCommand('', {});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });

    describe('generate subcommand', () => {
      it('应该生成提案', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue(['diagnosis1.json'] as any);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test',
          constraintId: 'test',
          rootCause: { primary: 'test' },
          impact: { severity: 'high' },
        }));

        const mockEvolver = {
          propose: jest.fn().mockResolvedValue({
            id: 'proposal-1',
            constraintId: 'test',
            type: 'adjust_threshold',
            risk: { level: 'low' },
          }),
        };
        const mockDoctor = {
          loadDiagnosis: jest.fn().mockReturnValue({
            anomalyId: 'test',
            constraintId: 'test',
            rootCause: { primary: 'test' },
            impact: { severity: 'high' },
          }),
        };

        mockCreateEvolver.mockReturnValue(mockEvolver as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);

        await proposeCommand('generate', {});
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('应该处理无诊断情况', async () => {
        mockFs.existsSync.mockReturnValue(false);

        await proposeCommand('generate', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No diagnoses'));
      });

      it('应该处理特定诊断', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test',
          constraintId: 'test',
        }));

        const mockEvolver = {
          propose: jest.fn().mockResolvedValue(null),
        };
        const mockDoctor = {
          loadDiagnosis: jest.fn().mockReturnValue({
            anomalyId: 'test',
            constraintId: 'test',
          }),
        };

        mockCreateEvolver.mockReturnValue(mockEvolver as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);

        await proposeCommand('generate', { diagnosisId: 'test' });
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('list subcommand', () => {
      it('应该列出所有提案', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue(['proposal1.json'] as any);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          proposals: [{ id: 'p1', constraintId: 'test', risk: { level: 'low' }, type: 'test' }],
        }));

        const mockEvolver = {
          propose: jest.fn(),
          listProposals: jest.fn().mockReturnValue([{ id: 'p1', risk: { level: 'low' } }]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('list', {});
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('应该处理无提案情况', async () => {
        mockFs.existsSync.mockReturnValue(false);
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('list', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No proposals'));
      });
    });

    describe('show subcommand', () => {
      it('应该显示特定提案', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          id: 'proposal-1',
          constraintId: 'test',
        }));

        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{ id: 'proposal-1' }]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('show', { diagnosisId: 'proposal-1' });
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('应该提示缺少 ID', async () => {
        await proposeCommand('show', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('specify'));
      });
    });
  });
});
