/**
 * report 命令测试
 */

import { report } from '../report';
import * as fs from 'fs/promises';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  writeFile: jest.fn(),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('report command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('report', () => {
    it('应该生成 JSON 格式报告', async () => {
      await report({ format: 'json' });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('timestamp');
    });

    it('应该生成 Markdown 格式报告', async () => {
      await report({ format: 'markdown' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Harness 检查报告'));
    });

    it('应该生成 HTML 格式报告', async () => {
      await report({ format: 'html' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
    });

    it('应该保存报告到文件', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await report({ format: 'json', output: 'report.json' });
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.json', expect.any(String), 'utf-8');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('报告已保存'));
    });

    it('应该使用自定义项目路径', async () => {
      await report({ format: 'json', projectPath: '/custom/path' });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('Markdown 报告应包含表格结构', async () => {
      await report({ format: 'markdown' });
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('| 指标 | 数值 |');
      expect(output).toContain('| 总约束 |');
      expect(output).toContain('报告由 @dommaker/harness 生成');
    });

    it('HTML 报告应包含完整结构', async () => {
      await report({ format: 'html' });
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      expect(output).toContain('<html lang="zh-CN">');
      expect(output).toContain('</html>');
      expect(output).toContain('Harness 检查报告');
      expect(output).toContain('<table>');
    });

    it('JSON 报告应包含约束统计', async () => {
      await report({ format: 'json' });
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
      // 过滤掉 chalk 的 emoji 行，只取 JSON 部分
      const jsonStart = output.indexOf('{');
      const jsonEnd = output.lastIndexOf('}');
      const jsonStr = output.slice(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.constraints).toBeDefined();
      expect(parsed.constraints.total).toBeGreaterThan(0);
      expect(parsed.constraints.ironLaws).toBeGreaterThan(0);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.projectPath).toBeDefined();
    });

    it('应该支持输出到文件 (markdown)', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      await report({ format: 'markdown', output: 'report.md' });
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.md', expect.stringContaining('# Harness'), 'utf-8');
    });

    it('应该支持输出到文件 (html)', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      await report({ format: 'html', output: 'report.html' });
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.html', expect.stringContaining('<!DOCTYPE html>'), 'utf-8');
    });
  });
});
