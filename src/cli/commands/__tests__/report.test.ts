/**
 * report 命令测试
 */

import { report } from '../report';
import { captureIO, type CapturingIO } from '../../command-contract';
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

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('report command', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('report', () => {
    it('应该生成 JSON 格式报告', async () => {
      await report({ format: 'json' }, io);
      expect(io.outText()).not.toBe('');
      const output = io.outText();
      expect(output).toContain('timestamp');
    });

    it('应该生成 Markdown 格式报告', async () => {
      await report({ format: 'markdown' }, io);
      expect(io.outText()).toContain('Harness 检查报告');
    });

    it('应该保存报告到文件', async () => {
      mockFs.writeFile.mockResolvedValue(undefined);

      await report({ format: 'json', output: 'report.json' }, io);
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.json', expect.any(String), 'utf-8');
      expect(io.outText()).toContain('报告已保存');
    });

    it('应该使用自定义项目路径', async () => {
      await report({ format: 'json', projectPath: '/custom/path' }, io);
      expect(io.outText()).not.toBe('');
    });

    it('Markdown 报告应包含表格结构', async () => {
      await report({ format: 'markdown' }, io);
      const output = io.outText();
      expect(output).toContain('| 指标 | 数值 |');
      expect(output).toContain('| 总约束 |');
      expect(output).toContain('报告由 @dommaker/harness 生成');
    });

    it('JSON 报告应包含约束统计', async () => {
      await report({ format: 'json' }, io);
      const output = io.outText();
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
      await report({ format: 'markdown', output: 'report.md' }, io);
      expect(mockFs.writeFile).toHaveBeenCalledWith('report.md', expect.stringContaining('# Harness'), 'utf-8');
    });
  });
});
