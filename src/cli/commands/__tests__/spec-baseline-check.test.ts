/**
 * spec-baseline-check 命令测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractBaselineSection, specBaselineCheck } from '../spec-baseline-check';

describe('spec-baseline-check', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-spec-baseline');
  let consoleSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let originalExitCode: string | number | undefined;

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

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    originalExitCode = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  describe('extractBaselineSection', () => {
    it('应该提取 ## Baseline section 中的列表项', () => {
      const content = [
        '# Spec Title',
        '',
        '## Overview',
        'Some overview text',
        '',
        '## Baseline',
        '- Node.js >= 18',
        '- TypeScript 5.x installed',
        '- `src/core/` directory exists',
        '',
        '## Details',
        'More details here',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(3);
      expect(results[0]).toBe('Node.js >= 18');
      expect(results[1]).toBe('TypeScript 5.x installed');
      expect(results[2]).toBe('`src/core/` directory exists');
    });

    it('应该提取 ## 前置条件 section', () => {
      const content = [
        '# 设计文档',
        '',
        '## 前置条件',
        '- 依赖包 `@dommaker/harness` 已安装',
        '- `package.json` 存在',
        '',
        '## 方案',
        '方案描述',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(2);
      expect(results[0]).toContain('@dommaker/harness');
    });

    it('应该支持编号列表', () => {
      const content = [
        '## Baseline',
        '1. Node.js 18+',
        '2. pnpm installed',
        '3. Docker available',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(3);
      expect(results[0]).toBe('Node.js 18+');
    });

    it('应该忽略非目标 section', () => {
      const content = [
        '## Baseline',
        '- Item 1',
        '',
        '## Other Section',
        '- Should not be included',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('Item 1');
    });

    it('没有 Baseline section 应返回空数组', () => {
      const content = [
        '# Spec',
        '## Overview',
        'No baseline here',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(0);
    });

    it('应该在遇到同级标题时停止', () => {
      const content = [
        '## Baseline',
        '- Item 1',
        '- Item 2',
        '## Next Section',
        '- Should not appear',
        '### Sub section',
        '- Also not',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(2);
    });

    it('应该支持嵌套在更高级标题下', () => {
      const content = [
        '# Main',
        '## Setup',
        '### Baseline',
        '- Prereq 1',
        '- Prereq 2',
        '### Details',  // 同级标题，应该停止
        '- Not included',
        '## More',  // 更高级标题，也应该停止
        '- Also not',
      ].join('\n');

      const results = extractBaselineSection(content);
      expect(results).toHaveLength(2);
      expect(results[0]).toBe('Prereq 1');
    });
  });

  describe('specBaselineCheck CLI', () => {
    it('应该在文件不存在时报错', async () => {
      await specBaselineCheck('/nonexistent/spec.md');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('文件不存在'));
      expect(process.exitCode).toBe(1);
    });

    it('没有 Baseline section 应该提示', async () => {
      const specPath = path.join(tempDir, 'no-baseline.md');
      fs.writeFileSync(specPath, '# Spec\n## Overview\nNo baseline here.');

      await specBaselineCheck(specPath, { projectPath: tempDir });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未找到'));
    });

    it('应该输出 table 格式结果', async () => {
      // 创建测试用的文件和目录
      const subDir = path.join(tempDir, 'test-project');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({ dependencies: {} }));

      const specPath = path.join(tempDir, 'with-baseline.md');
      fs.writeFileSync(specPath, [
        '# Test Spec',
        '## Baseline',
        '- `package.json` 文件存在',
        '- 普通文本描述',
      ].join('\n'));

      await specBaselineCheck(specPath, { projectPath: subDir });

      const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('前置条件检查');
    });

    it('应该输出 JSON 格式', async () => {
      const specPath = path.join(tempDir, 'json-test.md');
      fs.writeFileSync(specPath, [
        '# JSON Test',
        '## Baseline',
        '- `package.json` exists',
      ].join('\n'));

      await specBaselineCheck(specPath, { json: true, projectPath: tempDir });

      const jsonCall = consoleSpy.mock.calls.find((c: any[]) => {
        try {
          const parsed = JSON.parse(c[0]);
          return Array.isArray(parsed);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeTruthy();
      const parsed = JSON.parse(jsonCall[0]);
      expect(parsed.length).toBe(1);
      expect(parsed[0]).toHaveProperty('prerequisite');
      expect(parsed[0]).toHaveProperty('satisfied');
      expect(parsed[0]).toHaveProperty('evidence');
    });

    it('空 Baseline section 应该输出空结果', async () => {
      const specPath = path.join(tempDir, 'empty-baseline.md');
      fs.writeFileSync(specPath, '# Test\n## Baseline\n\n## Next');

      await specBaselineCheck(specPath, { json: true, projectPath: tempDir });

      const jsonCall = consoleSpy.mock.calls.find((c: any[]) => {
        try {
          const parsed = JSON.parse(c[0]);
          return parsed.prerequisites !== undefined;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeTruthy();
      expect(JSON.parse(jsonCall[0]).prerequisites).toHaveLength(0);
    });
  });
});
