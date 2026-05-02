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
  });
});
