/**
 * FileBudget 测试
 */

import { FileBudget } from '../file-budget';
import * as fs from 'fs';

jest.mock('fs', () => ({
  statSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('FileBudget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkFile', () => {
    it('应该允许小文件', () => {
      (mockFs.statSync as jest.Mock).mockReturnValue({ size: 1000 });
      const budget = new FileBudget();
      const result = budget.checkFile('/test/file.ts');
      expect(result.allowed).toBe(true);
    });

    it('应该拒绝超大文件', () => {
      (mockFs.statSync as jest.Mock).mockReturnValue({ size: 100000 });
      const budget = new FileBudget();
      const result = budget.checkFile('/test/large-file.ts');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('超过限制');
    });

    it('应该处理文件不存在', () => {
      (mockFs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const budget = new FileBudget();
      const result = budget.checkFile('/test/missing.ts');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('无法读取文件');
    });
  });

  describe('readWithBudget', () => {
    it('应该读取正常文件', () => {
      (mockFs.readFileSync as jest.Mock).mockReturnValue('line1\nline2\nline3');
      const budget = new FileBudget();
      const result = budget.readWithBudget('/test/file.ts');
      expect(result.content).toBe('line1\nline2\nline3');
      expect(result.truncated).toBe(false);
      expect(result.linesRead).toBe(3);
    });

    it('应该按行数截断', () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `line${i}`);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(lines.join('\n'));
      const budget = new FileBudget({ maxLines: 2000 });
      const result = budget.readWithBudget('/test/large.ts');
      expect(result.truncated).toBe(true);
      expect(result.linesRead).toBe(2000);
      expect(result.continuationHint).toContain('offset=2000');
    });

    it('应该按 token 数截断', () => {
      // 长内容超过 token 限制
      const longContent = 'a'.repeat(50000);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(longContent);
      const budget = new FileBudget({ maxTokenEstimate: 100, maxLines: 10000, maxBytes: 100000 });
      const result = budget.readWithBudget('/test/long.ts');
      expect(result.truncated).toBe(true);
    });

    it('应该处理读取失败', () => {
      (mockFs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const budget = new FileBudget();
      const result = budget.readWithBudget('/test/locked.ts');
      expect(result.content).toBe('');
      expect(result.continuationHint).toContain('无法读取文件');
    });

    it('应该支持自定义配置', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(lines.join('\n'));
      const budget = new FileBudget();
      const result = budget.readWithBudget('/test/file.ts', { maxLines: 50 });
      expect(result.truncated).toBe(true);
      expect(result.linesRead).toBe(50);
    });

    it('应该不生成 continuationHint 当配置关闭', () => {
      const lines = Array.from({ length: 3000 }, (_, i) => `line${i}`);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(lines.join('\n'));
      const budget = new FileBudget({ continuationHint: false, maxLines: 2000 });
      const result = budget.readWithBudget('/test/large.ts');
      expect(result.truncated).toBe(true);
      expect(result.continuationHint).toBeUndefined();
    });
  });

  describe('getConfig', () => {
    it('应该返回默认配置', () => {
      const budget = new FileBudget();
      const config = budget.getConfig();
      expect(config.maxLines).toBe(2000);
      expect(config.maxBytes).toBe(51200);
    });

    it('应该返回自定义配置', () => {
      const budget = new FileBudget({ maxLines: 1000 });
      const config = budget.getConfig();
      expect(config.maxLines).toBe(1000);
    });
  });
});
