/**
 * GovernanceExecutor 测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { GovernanceExecutor } from '../executor';

describe('GovernanceExecutor', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-governance');

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

  describe('detectDiffs', () => {
    it('无 CAPABILITIES.md 应该返回空差异', async () => {
      const testDir = path.join(tempDir, 'no-cap');
      fs.mkdirSync(testDir, { recursive: true });

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);
      expect(diffs).toEqual([]);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 无表格应该返回空差异', async () => {
      const testDir = path.join(tempDir, 'no-table');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'CAPABILITIES.md'), '# Capabilities\n\nNo table here.');

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);
      expect(diffs).toEqual([]);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('新增文件未在 CAPABILITIES.md 中列出应该检测到 doc_mismatch', async () => {
      const testDir = path.join(tempDir, 'missing-in-cap');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'new-module.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(srcDir, 'old.ts'), 'export const y = 2;');

      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |'
      );

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);

      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('doc_mismatch');
      expect(diffs[0].details.files).toContain('src/new-module.ts');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 中列出已删除文件应该检测到 doc_mismatch', async () => {
      const testDir = path.join(tempDir, 'removed-from-disk');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |'
      );

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);

      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('doc_mismatch');
      expect(diffs[0].details.files).toContain('src/old.ts');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 与源码同步应该无差异', async () => {
      const testDir = path.join(tempDir, 'in-sync');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'module.ts'), 'export const x = 1;');
      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| module | src/module.ts | module |'
      );

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);

      expect(diffs).toEqual([]);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CONTEXT.md 缺失应该检测到 context_missing', async () => {
      const testDir = path.join(tempDir, 'ctx-missing');
      const harnessDir = path.join(testDir, '.harness');
      fs.mkdirSync(harnessDir, { recursive: true });

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

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);

      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('context_missing');
      expect(diffs[0].details.moduleName).toBe('src');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CONTEXT.md 是模板应该检测到 context_outdated', async () => {
      const testDir = path.join(tempDir, 'ctx-template');
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

      fs.writeFileSync(
        path.join(srcDir, 'CONTEXT.md'),
        '# src\n\n<!-- 此文件描述 src 目录的职责和上下文 -->\n\n## 职责\n\n<!-- 本目录的核心职责是什么 -->'
      );

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);

      expect(diffs.length).toBe(1);
      expect(diffs[0].type).toBe('context_outdated');
      expect(diffs[0].details.moduleName).toBe('src');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('CONTEXT.md 已填写应该无差异', async () => {
      const testDir = path.join(tempDir, 'ctx-filled');
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

      fs.writeFileSync(
        path.join(srcDir, 'CONTEXT.md'),
        '# src\n\n源代码目录，包含所有核心模块。'
      );

      const executor = new GovernanceExecutor();
      const diffs = await executor.detectDiffs(testDir);

      expect(diffs).toEqual([]);

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('check', () => {
    it('有差异时 should return hasDiffs=true', async () => {
      const testDir = path.join(tempDir, 'check-diffs');
      const srcDir = path.join(testDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      fs.writeFileSync(path.join(srcDir, 'new.ts'), 'export const x = 1;');
      fs.writeFileSync(
        path.join(testDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |'
      );

      const executor = new GovernanceExecutor();
      const result = await executor.check(testDir);

      expect(result.hasDiffs).toBe(true);
      expect(result.diffs.length).toBeGreaterThan(0);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('无差异时 should return hasDiffs=false', async () => {
      const testDir = path.join(tempDir, 'check-no-diffs');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'CAPABILITIES.md'), '# Capabilities\n\nNo table.');

      const executor = new GovernanceExecutor();
      const result = await executor.check(testDir);

      expect(result.hasDiffs).toBe(false);
      expect(result.diffs).toEqual([]);

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('global singleton', () => {
    it('应该导出全局单例', () => {
      const { governanceExecutor } = require('../executor');
      expect(governanceExecutor).toBeInstanceOf(GovernanceExecutor);
    });
  });
});
