/**
 * validate 命令测试
 */

import { validate, createExampleCheckpoint } from '../validate';
import * as fs from 'fs/promises';
import { CheckpointValidator } from '../../../core/validators/checkpoint';
import * as yaml from 'js-yaml';

// Mock fs/promises
jest.mock('fs/promises', () => ({
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
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('validate', () => {
    it('应该跳过无检查点的情况', async () => {
      mockFs.readFile.mockRejectedValue(new Error('file not found'));
      
      await validate({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('没有定义检查点'));
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

      await validate({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('所有检查点验证通过'));
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

      await validate({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('失败'));
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

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await validate({ strict: true });
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });

  describe('createExampleCheckpoint', () => {
    it('应该创建示例检查点文件', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockYaml.dump.mockReturnValue('yaml content');

      await createExampleCheckpoint('/project');
      
      expect(mockFs.mkdir).toHaveBeenCalled();
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已创建示例检查点'));
    });
  });
});
