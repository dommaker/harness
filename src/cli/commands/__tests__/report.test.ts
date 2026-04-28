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
  });
});
