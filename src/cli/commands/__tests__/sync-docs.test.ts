/**
 * sync-docs 命令测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { syncDocs } from '../sync-docs';

describe('sync-docs command', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-sync-docs');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('generateModuleTable', () => {
    it('空模块列表应该跳过表格生成', async () => {
      const testDir = path.join(tempDir, 'empty-table');
      fs.mkdirSync(testDir, { recursive: true });

      // No src dir → no modules → nothing to report
      const result = await syncDocs({ projectPath: testDir });

      expect(result).toBe(true);
      // When no modules and no changes, all docs are current
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('所有文档'));

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('有模块时应该生成完整表格', async () => {
      const testDir = path.join(tempDir, 'with-table');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Create a source file with JSDoc comment
      fs.writeFileSync(path.join(srcDir, 'mymodule.ts'), '/**\n * My test module\n */\nexport const x = 1;');

      await syncDocs({ projectPath: testDir });

      const capPath = path.join(testDir, 'CAPABILITIES.md');
      const content = fs.readFileSync(capPath, 'utf-8');
      expect(content).toContain('| 模块 | 文件 | 说明 |');
      expect(content).toContain('mymodule');
      expect(content).toContain('My test module');

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('extractFirstComment', () => {
    it('JSDoc 注释应该被提取为模块描述', async () => {
      const testDir = path.join(tempDir, 'jsdoc-extract');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'jsdoc-mod.ts'), '/**\n * JSDoc module description\n */\nexport const y = 2;');

      await syncDocs({ projectPath: testDir });

      const capPath = path.join(testDir, 'CAPABILITIES.md');
      const content = fs.readFileSync(capPath, 'utf-8');
      expect(content).toContain('JSDoc module description');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('单行 // 注释应该被提取为模块描述', async () => {
      const testDir = path.join(tempDir, 'linecomment-extract');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Create a file with // style comment
      const filePath = path.join(srcDir, 'line-mod.ts');
      fs.writeFileSync(filePath, '// Line comment module\nexport const z = 3;');

      await syncDocs({ projectPath: testDir });

      const capPath = path.join(testDir, 'CAPABILITIES.md');
      const content = fs.readFileSync(capPath, 'utf-8');
      expect(content).toContain('Line comment module');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('无注释文件应该使用文件名作为描述', async () => {
      const testDir = path.join(tempDir, 'no-comment');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'bare.ts'), 'export const a = 1;');

      await syncDocs({ projectPath: testDir });

      const capPath = path.join(testDir, 'CAPABILITIES.md');
      const content = fs.readFileSync(capPath, 'utf-8');
      // Should use file basename as description when no comment
      expect(content).toContain('bare');

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });


  describe('syncDocs', () => {
    it('无 src/ 目录应该跳过模块扫描', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      const result = await syncDocs({ projectPath: emptyDir });
      expect(result).toBe(true);
      // 无 src/ 目录，模块扫描返回空，无差异
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('所有文档都是最新的'));

      fs.rmSync(emptyDir, { recursive: true, force: true });
    });

    it('所有文档都是最新的应该返回 true', async () => {
      const testDir = path.join(tempDir, 'up-to-date');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 创建 CAPABILITIES.md，无表格
      fs.writeFileSync(path.join(testDir, 'CAPABILITIES.md'), '# Capabilities\n\nNo table.');

      const result = await syncDocs({ projectPath: testDir });
      expect(result).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('--check 模式应该检测新增文件', async () => {
      const testDir = path.join(tempDir, 'check-mode');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 创建源文件
      fs.writeFileSync(path.join(srcDir, 'new-module.ts'), 'export const x = 1;');

      // CAPABILITIES.md 有表格但不包含新文件
      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |'
      );

      const result = await syncDocs({ projectPath: testDir, check: true });
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('文档不是最新的'));

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('描述以 / 结尾的表格行不应被误判为目录条目（check 必须收敛）', async () => {
      // 回归：JSDoc 首行在 "gitRepo /" 处换行时，生成的描述单元格以 / 结尾，
      // 旧目录条目正则将其误判为目录 → --check 永远报「包含已删除的模块」
      // （2026-08-04 studio PR #44 CI Governance 不收敛事故）
      const testDir = path.join(tempDir, 'trailing-slash-desc');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(srcDir, 'workspace.ts'),
        '/**\n * 归属链解析 — metadata.workspaceRoot（Requirement→gitRepo /\n * 人工绑定）优先。\n */\nexport const x = 1;\n'
      );

      // 第一轮：生成 CAPABILITIES.md（描述行以 / 结尾）
      await syncDocs({ projectPath: testDir });
      const cap = fs.readFileSync(path.join(testDir, 'CAPABILITIES.md'), 'utf-8');
      expect(cap).toContain('workspace.ts');
      expect(cap).toMatch(/gitRepo\s*\/\s*\|/);

      // 第二轮：生成后立即 --check 必须收敛（修复前此处必 false）
      consoleSpy.mockClear();
      const check = await syncDocs({ projectPath: testDir, check: true });
      expect(check).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('真正的目录条目（如 agents/）仍应被识别', async () => {
      const testDir = path.join(tempDir, 'dir-entry');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'mymodule.ts'), 'export const x = 1;');

      // CAPABILITIES.md 用目录条目记录 src/ 下的模块
      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| all | src/ | 全量记录 |'
      );

      // src/ 目录条目覆盖 mymodule.ts → 无 added，check 通过
      const result = await syncDocs({ projectPath: testDir, check: true });
      expect(result).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('应该检查 CONTEXT.md 是否存在', async () => {
      const testDir = path.join(tempDir, 'context-check');
      const harnessDir = path.join(testDir, '.harness');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // 写入 governance 配置
      const yaml = require('js-yaml');
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        yaml.dump({
          governance: {
            context_files: {
              enabled: true,
              required_dirs: ['src'],
            },
          },
        })
      );

      // 不创建 CONTEXT.md

      const result = await syncDocs({ projectPath: testDir });
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('缺少 CONTEXT.md'));

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CONTEXT.md 已存在应该通过', async () => {
      const testDir = path.join(tempDir, 'context-exists');
      const harnessDir = path.join(testDir, '.harness');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      const yaml = require('js-yaml');
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        yaml.dump({
          governance: {
            context_files: {
              enabled: true,
              required_dirs: ['src'],
            },
          },
        })
      );

      // 创建 CONTEXT.md
      fs.writeFileSync(path.join(srcDir, 'CONTEXT.md'), '# src\n\nTest context');

      const result = await syncDocs({ projectPath: testDir });
      expect(result).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('无 governance 配置不应该检查 CONTEXT.md', async () => {
      const testDir = path.join(tempDir, 'no-governance');
      fs.mkdirSync(testDir, { recursive: true });

      // 无 .harness/config.yml

      const result = await syncDocs({ projectPath: testDir });
      expect(result).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('应该创建缺失的 CONTEXT.md', async () => {
      const testDir = path.join(tempDir, 'create-context');
      const harnessDir = path.join(testDir, '.harness');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      const yaml = require('js-yaml');
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        yaml.dump({
          governance: {
            context_files: {
              enabled: true,
              required_dirs: ['src'],
            },
          },
        })
      );

      await syncDocs({ projectPath: testDir });

      // 验证 CONTEXT.md 被创建
      const contextPath = path.join(srcDir, 'CONTEXT.md');
      expect(fs.existsSync(contextPath)).toBe(true);
      const content = fs.readFileSync(contextPath, 'utf-8');
      expect(content).toContain('职责');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 不存在时应该创建', async () => {
      const testDir = path.join(tempDir, 'no-cap');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 创建源文件
      fs.writeFileSync(path.join(srcDir, 'module.ts'), 'export const x = 1;');

      await syncDocs({ projectPath: testDir });

      // 验证 CAPABILITIES.md 被创建
      const capPath = path.join(testDir, 'CAPABILITIES.md');
      expect(fs.existsSync(capPath)).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('--json 模式应该输出结构化 JSON', async () => {
      const testDir = path.join(tempDir, 'json-output');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'new.ts'), 'export const x = 1;');
      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |'
      );

      const result = await syncDocs({ projectPath: testDir, check: true, json: true });
      expect(result).toBe(false);

      // 验证 console.log 被调用了 JSON
      const jsonCall = consoleSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.stale).toBe(true);
      expect(parsed.added.length).toBeGreaterThan(0);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('--json 模式无差异应该输出 stale:false', async () => {
      const testDir = path.join(tempDir, 'json-ok');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'CAPABILITIES.md'), '# Capabilities\n\nNo table.');

      const result = await syncDocs({ projectPath: testDir, check: true, json: true });
      expect(result).toBe(true);

      const jsonCall = consoleSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
      );
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(parsed.stale).toBe(false);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('写入模式应移除已删除文件的行', async () => {
      const testDir = path.join(tempDir, 'remove-stale');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 创建两个源文件
      fs.writeFileSync(path.join(srcDir, 'kept.ts'), 'export const kept = 1;');
      fs.writeFileSync(path.join(srcDir, 'removed.ts'), 'export const removed = 1;');

      // 先让 syncDocs 创建初始 CAPABILITIES.md（包含两个文件）
      await syncDocs({ projectPath: testDir });
      let content = fs.readFileSync(path.join(testDir, 'CAPABILITIES.md'), 'utf-8');
      expect(content).toContain('kept.ts');
      expect(content).toContain('removed.ts');

      // 删除 removed.ts
      fs.unlinkSync(path.join(srcDir, 'removed.ts'));

      // 重新运行 syncDocs（写入模式）
      await syncDocs({ projectPath: testDir });
      content = fs.readFileSync(path.join(testDir, 'CAPABILITIES.md'), 'utf-8');
      expect(content).toContain('kept.ts');
      expect(content).not.toContain('removed.ts');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('basename 碰撞的幽灵条目（文件已删但同名文件存在）也应被移除', async () => {
      const testDir = path.join(tempDir, 'ghost-basename-collision');
      const srcA = path.join(testDir, 'src', 'a');
      fs.mkdirSync(srcA, { recursive: true });

      // 真实存在的同名文件
      fs.writeFileSync(path.join(srcA, 'routes.ts'), 'export const routes = 1;');

      // CAPABILITIES.md 另有一条指向不存在路径的 routes.ts（basename 碰撞，
      // 按 basename 对比时永远不可见 —— 2026-08-08 studio CI 4 连红事故）
      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        [
          '# CAPABILITIES.md', '',
          '> 最后更新: 2026-01-01', '', '---', '',
          '| 模块 | 文件 | 说明 |', '|------|------|------|',
          '| routes | src/a/routes.ts | 真实文件 |',
          '| routes | src/ghost/routes.ts | 幽灵条目 |',
          '',
        ].join('\n'),
      );

      await syncDocs({ projectPath: testDir });
      const content = fs.readFileSync(path.join(testDir, 'CAPABILITIES.md'), 'utf-8');
      expect(content).toContain('src/a/routes.ts');
      expect(content).not.toContain('src/ghost/routes.ts');

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });
});
