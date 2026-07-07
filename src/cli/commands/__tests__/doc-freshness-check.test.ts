/**
 * doc-freshness-check 命令测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractClaims, verifyClaims, docFreshnessCheck } from '../doc-freshness-check';

describe('doc-freshness-check', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-doc-freshness');
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

  describe('extractClaims', () => {
    it('应该提取数字声明', () => {
      const content = '系统包含 9 个 Agent 和 13 条规则';
      const results = extractClaims(content, 'test.md');

      expect(results.length).toBeGreaterThanOrEqual(2);
      const numericResults = results.filter(r => r.type === 'numeric');
      expect(numericResults.length).toBeGreaterThanOrEqual(2);
      expect(numericResults.some(r => r.expected === '9')).toBe(true);
      expect(numericResults.some(r => r.expected === '13')).toBe(true);
    });

    it('应该提取列表声明', () => {
      const content = '组件包括 Analyst, Executor, Reviewer, Monitor';
      const results = extractClaims(content, 'test.md');

      const listResults = results.filter(r => r.type === 'list');
      expect(listResults.length).toBeGreaterThanOrEqual(1);
      expect(listResults[0].expected).toContain('Analyst');
      expect(listResults[0].expected).toContain('Executor');
    });

    it('应该提取状态标记', () => {
      const content = '✅ 已完成\n❌ 缺失\nDEPRECATED\n待开发';
      const results = extractClaims(content, 'test.md');

      const statusResults = results.filter(r => r.type === 'status');
      expect(statusResults.length).toBeGreaterThanOrEqual(3);
    });

    it('应该忽略不含声明的行', () => {
      const content = '这是一段普通的描述文字\n没有可验证的内容';
      const results = extractClaims(content, 'test.md');

      expect(results.length).toBe(0);
    });

    it('应该处理混合内容', () => {
      const content = [
        '# 系统架构',
        '包含 8 个 Agent，5 大能力',
        'Agent 列表: Analyst, Executor, Reviewer, Knowledge, Monitor',
        '✅ 已完成核心功能',
        '待开发: xxx',
        '普通段落文字',
      ].join('\n');

      const results = extractClaims(content, 'test.md');
      expect(results.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('verifyClaims', () => {
    it('应该验证数字声明（命令计数）', () => {
      const claims = extractClaims('包含 22 个 subcommand', 'test.md');
      const results = verifyClaims(claims, path.join(__dirname, '../../../../'));

      expect(results.length).toBe(1);
      // harness 实际有很多命令，数字可能不完全匹配但应该有值
      expect(results[0].actual).not.toBe('');
    });

    it('应该验证列表声明', () => {
      const claims = extractClaims('组件: Analyst, Executor, Reviewer', 'test.md');
      // 用 harness 源码目录作为 projectPath
      const results = verifyClaims(claims, path.join(__dirname, '../../../../'));

      // 列表验证会检查代码中是否存在这些名称
      expect(results.length).toBe(1);
      expect(results[0].type).toBe('list');
    });

    it('状态标记应该标记为需人工确认', () => {
      const claims = extractClaims('✅ 已完成', 'test.md');
      const results = verifyClaims(claims, tempDir);

      expect(results.length).toBe(1);
      expect(results[0].match).toBe(true); // 不阻断
    });
  });

  describe('docFreshnessCheck CLI', () => {
    it('应该在文件不存在时报错', async () => {
      await docFreshnessCheck('/nonexistent/file.md');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('文件不存在'));
      expect(process.exitCode).toBe(1);
    });

    it('应该输出 table 格式', async () => {
      const docPath = path.join(tempDir, 'test-doc.md');
      fs.writeFileSync(docPath, '# Test\n系统有 9 个 Agent 和 13 条规则');

      await docFreshnessCheck(docPath, { projectPath: tempDir });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('文档新鲜度检查');
    });

    it('应该输出 JSON 格式', async () => {
      const docPath = path.join(tempDir, 'test-json.md');
      fs.writeFileSync(docPath, '# Test\n系统有 5 个 Agent');

      await docFreshnessCheck(docPath, { format: 'json', projectPath: tempDir });

      const jsonCall = consoleSpy.mock.calls.find((c: any[]) => {
        try {
          const parsed = JSON.parse(c[0]);
          return Array.isArray(parsed);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeTruthy();
    });

    it('空文档应该输出 0 条声明', async () => {
      const docPath = path.join(tempDir, 'empty.md');
      fs.writeFileSync(docPath, '# Empty\n\nNo claims here.');

      await docFreshnessCheck(docPath, { projectPath: tempDir });

      const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(output).toContain('未发现可验证的声明');
    });
  });
});
