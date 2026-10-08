/**
 * validate 命令测试
 */

import { validate } from '../validate';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as fs from 'fs/promises';
import { CheckpointValidator } from '../../../core/validators/checkpoint';
import * as yaml from 'js-yaml';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
}));

// Mock CheckpointValidator
jest.mock('../../../core/validators/checkpoint', () => ({
  CheckpointValidator: jest.fn(),
}));

// Mock yaml
jest.mock('js-yaml', () => ({
  load: jest.fn(),
  dump: jest.fn(),
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
const MockCheckpointValidator = CheckpointValidator as jest.Mocked<typeof CheckpointValidator>;
const mockYaml = yaml as jest.Mocked<typeof yaml>;

describe('validate command', () => {
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('应该跳过无检查点的情况（ENOENT = 合法空）', async () => {
      const enoent = new Error('file not found') as NodeJS.ErrnoException;
      enoent.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(enoent);

      const result = await validate({}, io);

      expect(io.outText()).toContain('没有定义检查点');
      expect(result).toEqual({ kind: 'skip', reason: expect.stringContaining('没有定义检查点') });
    });

    it('检查点文件 YAML 损坏 → 抛出（fail-fast：损坏 ≠ 缺失，不装「未找到」放行）', async () => {
      mockFs.readFile.mockResolvedValue('checkpoints: [broken');
      mockYaml.load.mockImplementation(() => {
        throw new Error('YAMLException: unexpected end of stream');
      });

      await expect(validate({}, io)).rejects.toThrow('YAMLException');
    });

    it('检查点文件读取失败（非 ENOENT，如权限） → 抛出', async () => {
      const eacces = new Error('permission denied') as NodeJS.ErrnoException;
      eacces.code = 'EACCES';
      mockFs.readFile.mockRejectedValue(eacces);

      await expect(validate({}, io)).rejects.toThrow('permission denied');
    });

    it('应该通过所有检查点', async () => {
      const mockCheckpoints = [
        { id: 'test-1', checks: [{ id: 'check-1', type: 'test' }] },
      ];
      
      mockFs.readFile.mockResolvedValue('checkpoints content');
      mockYaml.load.mockReturnValue({ checkpoints: mockCheckpoints });

      const mockValidator = {
        validate: jest.fn().mockResolvedValue({ passed: true, checks: [] }),
      };
      (MockCheckpointValidator as unknown as jest.Mock).mockImplementation(() => mockValidator);

      const result = await validate({}, io);

      expect(io.outText()).toContain('所有检查点验证通过');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('应该显示失败的检查点', async () => {
      const mockCheckpoints = [
        { id: 'test-1', checks: [{ id: 'check-1', type: 'test' }] },
      ];
      
      mockFs.readFile.mockResolvedValue('checkpoints content');
      mockYaml.load.mockReturnValue({ checkpoints: mockCheckpoints });

      const mockValidator = {
        validate: jest.fn().mockResolvedValue({
          passed: false,
          checks: [{ checkId: 'check-1', passed: false, message: 'failed' }],
        }),
      };
      (MockCheckpointValidator as unknown as jest.Mock).mockImplementation(() => mockValidator);

      // 工单 23：检查点失败一律 exit 1（门控语义）

      const result = await validate({}, io);

      expect(io.outText()).toContain('失败');
      expect(result).toEqual({ kind: 'fail', reason: '1 个检查点未通过: test-1' });
    });

    it('失败原因与 message 不同时一并打出来（真因不被 message 吞）', async () => {
      const mockCheckpoints = [
        { id: 'test-1', checks: [{ id: 'check-1', type: 'test' }] },
      ];

      mockFs.readFile.mockResolvedValue('checkpoints content');
      mockYaml.load.mockReturnValue({ checkpoints: mockCheckpoints });

      const mockValidator = {
        validate: jest.fn().mockResolvedValue({
          passed: false,
          checks: [{
            checkId: 'check-1',
            passed: false,
            message: '命令执行失败: npm test（退出码 1）',
            error: '输出末段:\nFAIL  某用例\nTests  1 failed',
          }],
        }),
      };
      (MockCheckpointValidator as unknown as jest.Mock).mockImplementation(() => mockValidator);

      await validate({}, io);

      expect(io.outText()).toContain('命令执行失败: npm test（退出码 1）');
      expect(io.outText()).toContain('Tests  1 failed');
    });

    it('error 与 message 同文时不重复打', async () => {
      const mockCheckpoints = [
        { id: 'test-1', checks: [{ id: 'check-1', type: 'test' }] },
      ];

      mockFs.readFile.mockResolvedValue('checkpoints content');
      mockYaml.load.mockReturnValue({ checkpoints: mockCheckpoints });

      const mockValidator = {
        validate: jest.fn().mockResolvedValue({
          passed: false,
          checks: [{ checkId: 'check-1', passed: false, message: '同一个原因', error: '同一个原因' }],
        }),
      };
      (MockCheckpointValidator as unknown as jest.Mock).mockImplementation(() => mockValidator);

      await validate({}, io);

      const printed = io.outText().split('\n').filter(line => line.includes('同一个原因'));
      expect(printed).toHaveLength(1);
    });

    it('检查点失败一律 fail（门控语义）', async () => {
      const mockCheckpoints = [
        { id: 'test-1', checks: [{ id: 'check-1', type: 'test' }] },
      ];

      mockFs.readFile.mockResolvedValue('checkpoints content');
      mockYaml.load.mockReturnValue({ checkpoints: mockCheckpoints });

      const mockValidator = {
        validate: jest.fn().mockResolvedValue({
          passed: false,
          checks: [{ checkId: 'check-1', passed: false, message: 'failed' }],
        }),
      };
      (MockCheckpointValidator as unknown as jest.Mock).mockImplementation(() => mockValidator);

      const result = await validate({}, io);

      // 工单 23 语义：检查点失败即 fail；退出码映射在 bin
      expect(result).toEqual({ kind: 'fail', reason: '1 个检查点未通过: test-1' });
    });
  });
});
