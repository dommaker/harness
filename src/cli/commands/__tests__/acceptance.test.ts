/**
 * acceptance 命令测试
 */

import { acceptance, listAcceptanceCriteria } from '../acceptance';
import { captureIO, type CapturingIO } from '../../command-contract';
import { decide, fakeGate, throwingGate } from './gate-decision';
import * as fs from 'fs/promises';
import { SpecAcceptanceGate } from '../../../gates/acceptance';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

jest.mock('../../../gates/acceptance', () => ({
  SpecAcceptanceGate: jest.fn().mockImplementation(() => ({
    evaluate: jest.fn(),
  })),
}));

jest.mock('../../../utils/yaml', () => ({
  load: jest.fn(),
}));

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockGate = SpecAcceptanceGate as jest.MockedClass<typeof SpecAcceptanceGate>;
const yaml = require('../../../utils/yaml');

describe('acceptance command', () => {
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
  });

  describe('acceptance', () => {
    it('should print success when check passes', async () => {
      MockGate.mockImplementation(() =>
        fakeGate(decide('acceptance', true, 'ok', { checkedCriteria: 5, totalCriteria: 5 })) as any
      );

      const result = await acceptance({}, io);

      expect(io.outText()).toContain('验收标准检查通过');
      expect(io.outText()).toContain('   通过项: 5');
      expect(io.outText()).toContain('   总项数: 5');
      expect(result.kind).toBe('ok');
    });

    it('should print failure and exit 1 when check fails', async () => {
      MockGate.mockImplementation(() =>
        fakeGate(
          decide('acceptance', false, 'criteria not met', {
            uncheckedCriteria: ['criteria-1', 'criteria-2'],
          })
        ) as any
      );

      const result = await acceptance({}, io);

      expect(io.outText()).toContain('验收标准检查失败');
      expect(io.outText()).toContain('   - criteria-1');
      expect(result).toEqual({
        kind: 'fail',
        reason: 'acceptance gate denied: criteria not met',
      });
    });

    it('should handle errors and exit 1', async () => {
      MockGate.mockImplementation(() => throwingGate(new Error('gate error')) as any);

      const result = await acceptance({}, io);

      expect(io.outText()).toContain('验收标准检查出错');
      expect(result).toEqual({
        kind: 'fail',
        reason: 'acceptance gate error: gate error',
      });
    });

    it('should use cwd as default projectPath', async () => {
      const gate = fakeGate(decide('acceptance', true, 'ok'));
      MockGate.mockImplementation(() => gate as any);

      await acceptance({}, io);

      expect(gate.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: process.cwd() }),
      );
    });

    it('should pass taskId to gate', async () => {
      const gate = fakeGate(decide('acceptance', true, 'ok'));
      MockGate.mockImplementation(() => gate as any);

      await acceptance({ taskId: 'TASK-001' }, io);

      expect(gate.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'TASK-001' }),
      );
    });

    it('should set e2eTestCommand when runE2e is true', async () => {
      MockGate.mockImplementation(() => fakeGate(decide('acceptance', true, 'ok')) as any);

      await acceptance({ runE2e: true }, io);

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ e2eTestCommand: 'npx playwright test' }),
      );
    });

    it('should not set e2eTestCommand when runE2e is false', async () => {
      MockGate.mockImplementation(() => fakeGate(decide('acceptance', true, 'ok')) as any);

      await acceptance({}, io);

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ e2eTestCommand: undefined }),
      );
    });
  });

  describe('listAcceptanceCriteria', () => {
    it('should list tasks and their criteria（新契约 acceptance 数组，含勾选标记与 e2e 标注）', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue({
        tasks: [
          {
            id: 'task-1',
            acceptance: [
              { description: 'Criteria 1', checked: true },
              { description: 'Criteria 2', checked: false, e2e_test: 'tests/c2.spec.ts' },
            ],
          },
          { id: 'task-2', acceptance: [{ description: 'Criteria A', checked: true }] },
        ],
      });

      const result = await listAcceptanceCriteria({}, io);

      expect(result).toEqual({ kind: 'ok' });
      expect(io.outText()).toContain('task-1:');
      expect(io.outText()).toContain('[✓] Criteria 1');
      expect(io.outText()).toContain('[ ] Criteria 2 (e2e: tests/c2.spec.ts)');
      expect(io.outText()).toContain('task-2:');
      expect(io.outText()).toContain('Criteria A');
    });

    it('should handle task with no criteria', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue({
        tasks: [{ id: 'task-1' }],
      });

      await listAcceptanceCriteria({}, io);

      expect(io.outText()).toContain('无验收标准');
    });

    it('非法形状（旧逐条勾选/任意 map）→ fail-fast 且输出解析错误，不再静默 ok/skip', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue({
        'task-1': { acceptanceCriteria: ['Criteria 1'] },
      });

      const result = await listAcceptanceCriteria({}, io);

      expect(result.kind).toBe('fail');
      expect(result).toHaveProperty('reason', expect.stringContaining('tasks.yml 解析失败'));
      expect(io.outText()).toContain('tasks.yml 解析失败');
    });

    it('yaml.load 返回 null（空文档）→ fail，不当作「未找到任务定义」skip', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue(null);

      const result = await listAcceptanceCriteria({}, io);

      expect(result.kind).toBe('fail');
      expect(io.outText()).toContain('tasks.yml 解析失败');
    });

    it('tasks.yml 不在场（ENOENT）→ skip，与门禁「无文件即跳过」语义一致', async () => {
      mockFs.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await listAcceptanceCriteria({}, io);

      expect(result.kind).toBe('skip');
      expect(result).toHaveProperty('reason', expect.stringContaining('未找到 tasks.yml'));
    });

    it('读取失败（非 ENOENT）→ fail，不再静默 skip', async () => {
      mockFs.readFile.mockRejectedValue(new Error('EACCES'));

      const result = await listAcceptanceCriteria({}, io);

      expect(result.kind).toBe('fail');
      expect(io.outText()).toContain('读取 tasks.yml 失败');
    });
  });
});
