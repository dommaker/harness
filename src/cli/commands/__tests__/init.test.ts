/**
 * init 命令测试
 */

import { init } from '../init';
import * as fs from 'fs/promises';

// Mock fs/promises
const mockReaddir = jest.fn().mockResolvedValue([]);
const existingFiles = new Set<string>();

// Mock fs (sync) for detectSourceRoots and setupClaudeMdConstraints
const mockExistsSync = jest.fn().mockReturnValue(false);
const mockReaddirSync = jest.fn().mockReturnValue([]);

jest.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
  statSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue('{"version": "1.0.0"}'),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
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
  createExampleResolutions: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

// Use explicit projectPath to avoid CI path mismatch
const PROJECT = '/test/project';

describe('init command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    existingFiles.clear();
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('init', () => {
    it('应该创建配置目录', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', projectPath: PROJECT });
      expect(mockFs.mkdir).toHaveBeenCalled();
    });

    it('应该使用 strict 预设', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'strict', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('strict'));
    });

    it('应该使用 relaxed 预设', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'relaxed', projectPath: PROJECT });
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
      // 打印版与落盘版 plan 匹配模式须一致（#35：模板字面量 \. 运行期退化为 .，防两副本 drift）
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("grep -E 'plans/.*\\.md$|\\.plan\\.md$'"));
    });
  });

  describe('Git hooks', () => {
    it('应该跳过 Git hooks 当无 .git 目录', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未检测到 Git 仓库'));
    });

    it('应该提示手动添加当 pre-commit 已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/.git`);
      existingFiles.add(`${PROJECT}/.git/hooks`);
      existingFiles.add(`${PROJECT}/.git/hooks/pre-commit`);

      await init({ preset: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pre-commit 已存在'));
      // 手动添加提示的片段同样 scoped 化（#36）
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('npx @dommaker/harness check --staged'));
    });

    it('应该创建 pre-commit hook', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/.git`);
      existingFiles.add(`${PROJECT}/.git/hooks`);

      await init({ preset: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已创建 .git/hooks/pre-commit'));
    });

    it('落盘 pre-commit 使用 scoped 包名（#36）', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/.git`);
      existingFiles.add(`${PROJECT}/.git/hooks`);

      await init({ preset: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const hookCall = writeCalls.find((c: any[]) => String(c[0]).includes('pre-commit'));
      expect(hookCall).toBeDefined();
      expect(hookCall![1]).toContain('npx @dommaker/harness check --staged');
      expect(hookCall![1]).toContain('npx @dommaker/harness posteval-plan');
      expect(hookCall![1]).not.toMatch(/npx harness /);
      // plan 匹配模式须为转义点（#35：模板字面量 \. 运行期退化为 .，与打印版防 drift）
      expect(hookCall![1]).toContain("grep -E 'plans/.*\\.md$|\\.plan\\.md$'");
    });
  });

  describe('GitHub Actions', () => {
    it('应该提示当已有 CI 配置', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue(['ci.yml']);
      existingFiles.add(`${PROJECT}/.github/workflows`);

      await init({ preset: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已存在的 CI 配置'));
    });

    it('落盘 harness-check.yml 使用 scoped 包名（#36）', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-check.yml'));
      expect(workflowCall).toBeDefined();
      expect(workflowCall![1]).toContain('npx @dommaker/harness check');
      expect(workflowCall![1]).toContain('npx @dommaker/harness validate');
      expect(workflowCall![1]).toContain('npx @dommaker/harness passes-gate');
      expect(workflowCall![1]).not.toMatch(/npx harness /);
    });
  });

  describe('CAPABILITIES.md', () => {
    it('init 不应创建 CAPABILITIES.md（由 sync-docs 管理）', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', projectPath: PROJECT });
      const writes = mockFs.writeFile.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(writes.every((w: string) => !w.includes('CAPABILITIES.md'))).toBe(true);
    });
  });

  describe('custom-constraints', () => {
    it('应该跳过创建当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/.harness/custom-constraints.yml`);

      await init({ preset: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('custom-constraints.yml 已存在'));
    });
  });

  describe('governance', () => {
    it('应该在配置中包含 governance 段', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('治理级别: standard'));
    });

    it('应该创建 CHANGELOG.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const changelogCall = writeCalls.find((c: any[]) => String(c[0]).includes('CHANGELOG.md'));
      expect(changelogCall).toBeDefined();
      expect(changelogCall![1]).toContain('Changelog');
    });

    it('应该跳过 CHANGELOG.md 当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/CHANGELOG.md`);

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CHANGELOG.md 已存在'));
    });

    it('应该为 standard 治理创建 src/CONTEXT.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/src`);

      mockExistsSync.mockImplementation((path: string) => path === `${PROJECT}/src`);
      mockReaddirSync.mockImplementation((dir: string) => {
        if (dir === `${PROJECT}/src`) {
          return [{ name: 'index.ts', isFile: () => true, isDirectory: () => false }];
        }
        return [];
      });

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const contextCall = writeCalls.find((c: any[]) => String(c[0]).includes('CONTEXT.md'));
      expect(contextCall).toBeDefined();
      expect(contextCall![1]).toContain('职责');
    });

    it('应该跳过 CONTEXT.md 当目录不存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const contextCall = writeCalls.find((c: any[]) => String(c[0]).includes('CONTEXT.md'));
      expect(contextCall).toBeUndefined();
    });

    it('minimal 治理不应创建 CONTEXT.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'minimal', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const contextCall = writeCalls.find((c: any[]) => String(c[0]).includes('CONTEXT.md'));
      expect(contextCall).toBeUndefined();
    });

    it('应该创建治理 CI workflow', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall).toBeDefined();
      expect(workflowCall![1]).toContain('Harness Governance');
      expect(workflowCall![1]).toContain('harness check');
      // scoped 包名（#36）
      expect(workflowCall![1]).toContain('npx @dommaker/harness check');
      expect(workflowCall![1]).toContain('npx @dommaker/harness passes-gate');
      expect(workflowCall![1]).not.toMatch(/npx harness /);
    });

    it('应该跳过治理 CI workflow 当已存在', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/.github/workflows/harness-governance.yml`);

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('harness-governance.yml 已存在'));
    });

    it('应该跳过治理 CI workflow 当已有 workflow 覆盖治理命令', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      // setupGitHubActions 与治理能力检测都会 readdir workflows 目录
      existingFiles.add(`${PROJECT}/.github/workflows`);
      mockReaddir.mockResolvedValue(['ci.yml']);
      mockFs.readFile.mockImplementation((p: any) =>
        String(p).includes('ci.yml')
          ? Promise.resolve('run: npx harness sync-docs --agents && npx harness check && npx harness sync-docs --check --agents')
          : Promise.reject(new Error('ENOENT'))
      );

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('治理检查已由 ci.yml 覆盖'));

      mockReaddir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    });

    it('应该正常创建治理 CI workflow 当已有 workflow 不含治理命令', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      existingFiles.add(`${PROJECT}/.github/workflows`);
      mockReaddir.mockResolvedValue(['ci.yml']);
      mockFs.readFile.mockImplementation((p: any) =>
        String(p).includes('ci.yml')
          ? Promise.resolve('run: npm test')
          : Promise.reject(new Error('ENOENT'))
      );

      await init({ preset: 'standard', governance: 'standard', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall).toBeDefined();
      expect(workflowCall![1]).toContain('Harness Governance');

      mockReaddir.mockResolvedValue([]);
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    });

    it('strict 治理应在 CI 中包含 docs check', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'strict', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall![1]).toContain('sync-docs');
      expect(workflowCall![1]).toContain('npx @dommaker/harness sync-docs --check');
    });

    it('minimal 治理不应在 CI 中包含 docs check', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', governance: 'minimal', projectPath: PROJECT });
      const writeCalls = mockFs.writeFile.mock.calls;
      const workflowCall = writeCalls.find((c: any[]) => String(c[0]).includes('harness-governance.yml'));
      expect(workflowCall![1]).not.toContain('sync-docs');
    });

    it('无 governance 选项时不应创建治理文件', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await init({ preset: 'standard', projectPath: PROJECT });
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
