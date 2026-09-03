/**
 * validate 命令测试
 */

import { validate, createExampleCheckpoint, createExampleResolutions } from '../validate';
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
  CheckpointValidator: {
    getInstance: jest.fn(),
  },
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
    it('应该跳过无检查点的情况', async () => {
      mockFs.readFile.mockRejectedValue(new Error('file not found'));
      
      const result = await validate({}, io);

      expect(io.outText()).toContain('没有定义检查点');
      expect(result).toEqual({ kind: 'skip', reason: expect.stringContaining('没有定义检查点') });
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
      (MockCheckpointValidator.getInstance as jest.Mock).mockReturnValue(mockValidator);

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
      (MockCheckpointValidator.getInstance as jest.Mock).mockReturnValue(mockValidator);

      // 工单 23：检查点失败一律 exit 1（门控语义）

      const result = await validate({}, io);

      expect(io.outText()).toContain('失败');
      expect(result).toEqual({ kind: 'fail', reason: '1 个检查点未通过: test-1' });
    });

    it('应该在严格模式下退出', async () => {
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
      (MockCheckpointValidator.getInstance as jest.Mock).mockReturnValue(mockValidator);

      const result = await validate({ strict: true }, io);

      // 工单 23 语义：--strict 与否都是 fail；退出码映射在 bin
      expect(result).toEqual({ kind: 'fail', reason: '1 个检查点未通过: test-1' });
    });
  });

  describe('createExampleCheckpoint', () => {
    it('应该创建示例检查点文件', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockYaml.dump.mockReturnValue('yaml content');

      await createExampleCheckpoint('/project', io);
      
      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(io.outText()).toContain('已创建示例检查点');
    });

    it('已存在时不覆盖', async () => {
      mockFs.access.mockResolvedValue(undefined);

      await createExampleCheckpoint('/project', io);

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(io.outText()).toContain('checkpoints.yml 已存在，跳过');
    });
  });

  describe('createExampleResolutions', () => {
    it('应该创建 Resolutions 文件', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await createExampleResolutions('/project', io);

      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(io.outText()).toContain('已创建 Resolutions 文件');
    });

    it('已存在时不覆盖', async () => {
      mockFs.access.mockResolvedValue(undefined);

      await createExampleResolutions('/project', io);

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(io.outText()).toContain('resolutions.json 已存在，跳过');
    });
  });
});
