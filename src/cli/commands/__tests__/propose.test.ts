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

      it('应该处理提案未找到', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('show', { diagnosisId: 'not-found' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      });

      it('应该支持 JSON 格式输出', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'proposal-1',
            constraintId: 'test',
            type: 'adjust_threshold',
            status: 'proposed',
            risk: { level: 'low' },
          }]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('show', { diagnosisId: 'proposal-1', format: 'json' });
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('review subcommand', () => {
      it('应该提示缺少 ID', async () => {
        await proposeCommand('review', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('specify'));
      });

      it('应该提示缺少 accept/reject', async () => {
        await proposeCommand('review', { diagnosisId: 'test' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--accept or --reject'));
      });

      it('应该处理提案未找到', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('review', { diagnosisId: 'not-found', accept: true });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      });

      it('应该接受提案', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'proposal-1',
            diagnosisId: 'test-diagnosis',
          }]),
          updateProposalStatus: jest.fn(),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('review', { diagnosisId: 'test-diagnosis', accept: true });
        expect(mockEvolver.updateProposalStatus).toHaveBeenCalledWith(
          'proposal-1',
          'accepted',
          undefined
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Accepted'));
      });

      it('应该拒绝提案', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'proposal-1',
            diagnosisId: 'test-diagnosis',
          }]),
          updateProposalStatus: jest.fn(),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('review', { diagnosisId: 'test-diagnosis', reject: true });
        expect(mockEvolver.updateProposalStatus).toHaveBeenCalledWith(
          'proposal-1',
          'rejected',
          undefined
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Rejected'));
      });

      it('应该带评论审核', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'proposal-1',
            diagnosisId: 'test-diagnosis',
          }]),
          updateProposalStatus: jest.fn(),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('review', {
          diagnosisId: 'test-diagnosis',
          accept: true,
          comment: 'LGTM',
        });
        expect(mockEvolver.updateProposalStatus).toHaveBeenCalledWith(
          'proposal-1',
          'accepted',
          'LGTM'
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('LGTM'));
      });
    });

    describe('implement subcommand', () => {
      it('应该提示缺少 ID', async () => {
        await proposeCommand('implement', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('specify'));
      });

      it('应该处理无已接受提案', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('implement', { diagnosisId: 'test' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No accepted proposal'));
      });

      it('应该显示实施指导', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'proposal-1',
            diagnosisId: 'test-diagnosis',
            constraintId: 'test-constraint',
            type: 'adjust_threshold',
          }]),
          implement: jest.fn().mockReturnValue({
            instructions: ['Update config', 'Run tests'],
            filesToModify: ['config.json', 'index.ts'],
            testsToRun: ['npm test'],
          }),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('implement', { diagnosisId: 'test-diagnosis' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Implementation Instructions'));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Update config'));
      });
    });

    describe('generate 边界情况', () => {
      it('应该处理诊断目录不存在', async () => {
        mockFs.existsSync.mockReturnValue(false);

        await proposeCommand('generate', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No diagnoses'));
      });

      it('应该处理特定诊断不存在', async () => {
        mockFs.existsSync.mockReturnValue(false);

        await proposeCommand('generate', { diagnosisId: 'non-existent' });
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      });

      it('应该处理无 needsChange 诊断', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue(['diagnosis1.json'] as any);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test',
          constraintId: 'test',
          needsChange: false,
        }));

        const mockDoctor = {
          loadDiagnosis: jest.fn().mockReturnValue({
            anomalyId: 'test',
            needsChange: false,
          }),
        };
        mockCreateDoctor.mockReturnValue(mockDoctor as any);

        await proposeCommand('generate', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No diagnoses need constraint changes'));
      });

      it('应该保存提案', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue(['diagnosis1.json'] as any);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test',
          needsChange: true,
        }));

        const mockEvolver = {
          proposeBatch: jest.fn().mockResolvedValue([{
            id: 'proposal-1',
            constraintId: 'test',
            type: 'adjust_threshold',
            status: 'proposed',
            content: { description: 'test proposal' },
            risk: { level: 'low' },
            expectedOutcome: 'better behavior',
          }]),
          saveProposal: jest.fn(),
        };
        const mockDoctor = {
          loadDiagnosis: jest.fn().mockReturnValue({
            anomalyId: 'test',
            needsChange: true,
          }),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);

        await proposeCommand('generate', { save: true });
        expect(mockEvolver.saveProposal).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Saved'));
      });

      it('应该支持 JSON 格式', async () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readdirSync.mockReturnValue(['diagnosis1.json'] as any);
        mockFs.readFileSync.mockReturnValue(JSON.stringify({
          anomalyId: 'test',
          needsChange: true,
        }));

        const mockEvolver = {
          proposeBatch: jest.fn().mockResolvedValue([{
            id: 'proposal-1',
            constraintId: 'test',
          }]),
        };
        const mockDoctor = {
          loadDiagnosis: jest.fn().mockReturnValue({
            anomalyId: 'test',
            needsChange: true,
          }),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);
        mockCreateDoctor.mockReturnValue(mockDoctor as any);

        await proposeCommand('generate', { format: 'json' });
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('list 边界情况', () => {
      it('应该支持状态过滤', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('list', { status: 'accepted' });
        expect(mockEvolver.listProposals).toHaveBeenCalledWith('accepted');
      });

      it('应该支持 JSON 格式', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'p1',
            constraintId: 'test',
            type: 'adjust',
            status: 'proposed',
            risk: { level: 'low' },
          }]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('list', { format: 'json' });
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('应该显示提案详情', async () => {
        const mockEvolver = {
          listProposals: jest.fn().mockReturnValue([{
            id: 'p1',
            constraintId: 'test-constraint',
            type: 'adjust_threshold',
            status: 'proposed',
            risk: { level: 'medium', description: 'test risk' },
          }]),
        };
        mockCreateEvolver.mockReturnValue(mockEvolver as any);

        await proposeCommand('list', {});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test-constraint'));
      });
    });
  });
});
