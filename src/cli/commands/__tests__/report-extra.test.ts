/**
 * report 命令补充测试
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

describe('report command - 补充覆盖', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('format 边界情况', () => {
    it('未知格式应该默认输出 JSON', async () => {
      await report({ format: 'json' });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('timestamp');
    });
  });

  describe('Markdown 报告完整内容', () => {
    it('Markdown 报告应该包含所有区块', async () => {
      await report({ format: 'markdown' });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');

      expect(output).toContain('# Harness 检查报告');
      expect(output).toContain('## 约束检查');
      expect(output).toContain('Iron Laws');
      expect(output).toContain('Guidelines');
      expect(output).toContain('@dommaker/harness');
    });
  });

  describe('HTML 报告完整内容', () => {
    it('HTML 报告应该包含所有区块', async () => {
      await report({ format: 'html' });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');

      expect(output).toContain('<!DOCTYPE html>');
      expect(output).toContain('<title>Harness 检查报告</title>');
      expect(output).toContain('约束检查');
      expect(output).toContain('Iron Laws');
    });
  });

  describe('文件输出', () => {
    it('Markdown 输出到文件', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await report({ format: 'markdown', output: 'report.md' });
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.md', expect.stringContaining('# Harness'), 'utf-8');
    });

    it('HTML 输出到文件', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await report({ format: 'html', output: 'report.html' });
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.html', expect.stringContaining('<!DOCTYPE html>'), 'utf-8');
    });
  });

  describe('JSON 报告内容', () => {
    it('JSON 应该包含完整数据结构', async () => {
      await report({ format: 'json' });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const jsonStart = output.indexOf('{');
      const jsonStr = output.slice(jsonStart);
      const data = JSON.parse(jsonStr);
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('constraints');
      expect(data.constraints).toHaveProperty('total');
      expect(data.constraints).toHaveProperty('ironLaws');
      expect(data.constraints).toHaveProperty('guidelines');
      expect(data.constraints).toHaveProperty('violations');
    });
  });
});
