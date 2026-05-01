/**
 * init 命令测试
 */

import { init } from '../init';
import * as fs from 'fs/promises';

// Mock fs/promises
const mockReaddir = jest.fn().mockResolvedValue([]);

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  access: jest.fn(),
  chmod: jest.fn(),
  readdir: (...args: any[]) => mockReaddir(...args),
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

  describe('Git hooks', () => {
    it('应该跳过 Git hooks 当无 .git 目录', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.access.mockReset();
      mockFs.access.mockRejectedValue(new Error('not found'));

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未检测到 Git 仓库'));
    });

    it('应该提示手动添加当 pre-commit 已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.access.mockReset();
      mockFs.access
        .mockRejectedValueOnce(new Error('no cap')) // CAPABILITIES.md
        .mockResolvedValueOnce(undefined) // .git
        .mockResolvedValueOnce(undefined) // hooks dir
        .mockResolvedValueOnce(undefined) // pre-commit exists
        .mockRejectedValueOnce(new Error('no custom')); // custom-constraints.yml

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pre-commit 已存在'));
    });

    it('应该创建 pre-commit hook', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.access.mockReset();
      mockFs.access
        .mockRejectedValueOnce(new Error('no cap')) // CAPABILITIES.md
        .mockResolvedValueOnce(undefined) // .git
        .mockResolvedValueOnce(undefined) // hooks dir
        .mockRejectedValueOnce(new Error('no pre-commit')) // pre-commit not exists
        .mockRejectedValueOnce(new Error('no custom')); // custom-constraints.yml

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已创建 .git/hooks/pre-commit'));
    });
  });

  describe('GitHub Actions', () => {
    it('应该提示当已有 CI 配置', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['ci.yml']);
      mockFs.access.mockReset();
      mockFs.access
        .mockRejectedValueOnce(new Error('no custom')) // custom-constraints.yml
        .mockRejectedValueOnce(new Error('no cap')) // CAPABILITIES.md
        .mockResolvedValueOnce(undefined) // .git
        .mockRejectedValueOnce(new Error('no pre-commit')) // pre-commit
        .mockResolvedValueOnce(undefined); // workflows dir

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已存在的 CI 配置'));
    });
  });

  describe('CAPABILITIES.md', () => {
    it('应该跳过创建当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.access.mockReset();
      mockFs.access
        .mockRejectedValueOnce(new Error('no custom')) // custom-constraints.yml
        .mockResolvedValueOnce(undefined) // CAPABILITIES.md exists
        .mockResolvedValueOnce(undefined) // .git
        .mockRejectedValueOnce(new Error('no pre-commit')) // pre-commit
        .mockResolvedValueOnce(undefined); // workflows dir
      mockReaddir.mockResolvedValue([]);

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CAPABILITIES.md 已存在'));
    });
  });

  describe('custom-constraints', () => {
    it('应该跳过创建当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.access.mockReset();
      mockFs.access
        .mockResolvedValueOnce(undefined) // custom-constraints.yml exists
        .mockRejectedValueOnce(new Error('no cap')) // CAPABILITIES.md
        .mockResolvedValueOnce(undefined) // .git
        .mockRejectedValueOnce(new Error('no pre-commit')) // pre-commit
        .mockResolvedValueOnce(undefined); // workflows dir
      mockReaddir.mockResolvedValue([]);

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('custom-constraints.yml 已存在'));
    });
  });
});
