/**
 * init 命令测试
 */

import { init } from '../init';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  access: jest.fn(),
}));

// Mock js-yaml
jest.mock('js-yaml', () => ({
  dump: jest.fn().mockReturnValue('yaml content'),
  load: jest.fn(),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
  cyan: jest.fn((str: string) => str),
  bold: jest.fn((str: string) => str),
}));

// Mock validate module
jest.mock('../validate', () => ({
  createExampleCheckpoint: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('init command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('init', () => {
    it('应该创建配置目录', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard' });
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it('应该使用 strict 预设', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'strict' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('strict'));
    });

    it('应该使用 relaxed 预设', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'relaxed' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('relaxed'));
    });

    it('应该支持自定义项目路径', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', projectPath: '/custom/path' });
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it('应该输出代码片段模式', async () => {
      await init({ preset: 'standard', printSnippets: true });
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
