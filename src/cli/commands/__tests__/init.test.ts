/**
 * init 命令测试
 */

import { init } from '../init';
import * as fs from 'fs/promises';

// Mock fs/promises
const mockReaddir = jest.fn().mockResolvedValue([]);
const existingFiles = new Set<string>();

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  access: jest.fn((path: string) => {
    if (existingFiles.has(path)) return Promise.resolve(undefined);
    return Promise.reject(new Error(`ENOENT: ${path}`));
  }),
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
    existingFiles.clear();
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

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未检测到 Git 仓库'));
    });

    it('应该提示手动添加当 pre-commit 已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      // .git exists, pre-commit exists
      existingFiles.add('/root/projects/harness/.git');
      existingFiles.add('/root/projects/harness/.git/hooks');
      existingFiles.add('/root/projects/harness/.git/hooks/pre-commit');

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pre-commit 已存在'));
    });

    it('应该创建 pre-commit hook', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      // .git exists, but pre-commit doesn't
      existingFiles.add('/root/projects/harness/.git');
      existingFiles.add('/root/projects/harness/.git/hooks');

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已创建 .git/hooks/pre-commit'));
    });
  });

  describe('GitHub Actions', () => {
    it('应该提示当已有 CI 配置', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['ci.yml']);
      // workflows dir exists so findCiWorkflows can read it
      existingFiles.add('/root/projects/harness/.github/workflows');

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已存在的 CI 配置'));
    });
  });

  describe('CAPABILITIES.md', () => {
    it('应该跳过创建当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add('/root/projects/harness/CAPABILITIES.md');

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CAPABILITIES.md 已存在'));
    });
  });

  describe('custom-constraints', () => {
    it('应该跳过创建当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add('/root/projects/harness/.harness/custom-constraints.yml');

      await init({ preset: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('custom-constraints.yml 已存在'));
    });
  });

  describe('governance', () => {
    it('应该在配置中包含 governance 段', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('治理级别: standard'));
    });

    it('应该创建 CHANGELOG.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const changelogCall = writeCalls.find((c: any[]) => String(c[0]).includes('CHANGELOG.md'));
      expect(changelogCall).toBeDefined();
      expect(changelogCall![1]).toContain('Changelog');
    });

    it('应该跳过 CHANGELOG.md 当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add('/root/projects/harness/CHANGELOG.md');

      await init({ preset: 'standard', governance: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CHANGELOG.md 已存在'));
    });

    it('应该为 standard 治理创建 src/CONTEXT.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      // src/ directory exists
      existingFiles.add('/root/projects/harness/src');

      await init({ preset: 'standard', governance: 'standard' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const contextCall = writeCalls.find((c: any[]) => String(c[0]).includes('CONTEXT.md'));
      expect(contextCall).toBeDefined();
      expect(contextCall![1]).toContain('职责');
    });

    it('应该跳过 CONTEXT.md 当目录不存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      // src/ does NOT exist

      await init({ preset: 'standard', governance: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('目录 src 不存在'));
    });

    it('minimal 治理不应创建 CONTEXT.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'minimal' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const contextCall = writeCalls.find((c: any[]) => String(c[0]).includes('CONTEXT.md'));
      expect(contextCall).toBeUndefined();
    });

    it('应该创建治理 CI workflow', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall).toBeDefined();
      expect(workflowCall![1]).toContain('Harness Governance');
      expect(workflowCall![1]).toContain('harness check');
    });

    it('应该跳过治理 CI workflow 当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add('/root/projects/harness/.github/workflows/harness-governance.yml');

      await init({ preset: 'standard', governance: 'standard' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('harness-governance.yml 已存在'));
    });

    it('strict 治理应在 CI 中包含 docs check', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'strict' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall![1]).toContain('sync-docs');
    });

    it('minimal 治理不应在 CI 中包含 docs check', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'minimal' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall![1]).not.toContain('sync-docs');
    });

    it('无 governance 选项时不应创建治理文件', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard' });
      const writeCalls = mockFs.writeFile.mock.calls;
      const changelogCall = writeCalls.find((c: any[]) => String(c[0]).includes('CHANGELOG.md'));
      const contextCall = writeCalls.find((c: any[]) => String(c[0]).includes('CONTEXT.md'));
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(changelogCall).toBeUndefined();
      expect(contextCall).toBeUndefined();
      expect(workflowCall).toBeUndefined();
    });
  });
});
