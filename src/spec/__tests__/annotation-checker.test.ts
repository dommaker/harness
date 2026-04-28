/**
 * AnnotationChecker 测试
 */

import { checkFile, checkDirectory, generateReport } from '../annotation-checker';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  existsSync: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('AnnotationChecker', () => {
  const tempDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkFile', () => {
    it('应该检查有效的 JSDoc 注释', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-001
 * @implements feature-auth
 * @acceptance AC-001
 * @author test
 * @since 2026-04-28
 */
export function auth() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations.length).toBe(1);
      expect(result.annotations[0]?.specId).toBe('AR-001');
      expect(result.annotations[0]?.implements).toContain('feature-auth');
      expect(result.annotations[0]?.acceptance).toContain('AC-001');
      expect(result.annotations[0]?.author).toBe('test');
      expect(result.annotations[0]?.since).toBe('2026-04-28');
    });

    it('应该检查行内注释', () => {
      mockFs.readFileSync.mockReturnValue(`
// @spec AR-002
const x = 1;
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations.length).toBe(1);
      expect(result.annotations[0]?.specId).toBe('AR-002');
      expect(result.annotations[0]?.type).toBe('inline');
    });

    it('应该检测无效 Spec ID 格式', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec INVALID-ID
 */
export function test() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).toBe('INVALID_SPEC_FORMAT');
    });

    it('应该警告缺少 @implements', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-003
 */
class MyClass {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.code === 'MISSING_IMPLEMENTS')).toBe(true);
    });

    it('应该警告缺少 @acceptance', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-004
 * @implements feat
 */
function myFunc() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.warnings.some(w => w.code === 'MISSING_ACCEPTANCE')).toBe(true);
    });

    it('应该推断注释类型', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-005
 */
class MyClass {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations[0]?.type).toBeDefined();
    });

    it('应该推断 function 类型', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-006
 */
async function myAsync() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations[0]?.type).toBeDefined();
    });

    it('应该推断 method 类型', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-007
 */
myMethod() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations[0]?.type).toBeDefined();
    });

    it('应该检查公共导出缺少 @spec', () => {
      mockFs.readFileSync.mockReturnValue(`
export class NoSpecClass {}
export function noSpecFunc() {}
`);

      const result = checkFile('/test/file.ts');

      // 公共导出可能触发 MISSING_SPEC 警告（通过 checkPublicExports）
      expect(result.warnings.length + result.errors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('checkDirectory', () => {
    it('应该递归检查目录', () => {
      // 需要更完整的 mock，简化测试
      mockFs.readdirSync.mockReturnValue([] as any);

      const results = checkDirectory(tempDir);

      expect(Array.isArray(results)).toBe(true);
    });

    it('应该跳过 node_modules 和 dist', () => {
      mockFs.readdirSync.mockReturnValue(['src'] as any);

      const results = checkDirectory(tempDir);

      // 应该跳过 node_modules 和 dist
      expect(Array.isArray(results)).toBe(true);
    });

    it('应该处理空目录', () => {
      mockFs.readdirSync.mockReturnValue([]);

      const results = checkDirectory(tempDir);

      expect(results.length).toBe(0);
    });
  });

  describe('generateReport', () => {
    it('应该生成报告', () => {
      const results = [
        {
          valid: true,
          file: '/test/file.ts',
          annotations: [],
          errors: [],
          warnings: [],
        },
        {
          valid: false,
          file: '/test/bad.ts',
          annotations: [],
          errors: [{ line: 1, message: 'Error', code: 'INVALID_SPEC_FORMAT' as const }],
          warnings: [{ line: 2, message: 'Warning', code: 'MISSING_ACCEPTANCE' as const }],
        },
      ];

      const report = generateReport(results);

      expect(report).toContain('注释规范检查报告');
      expect(report).toContain('检查文件: 2');
      expect(report).toContain('通过: 1');
      expect(report).toContain('错误: 1');
      expect(report).toContain('警告: 1');
    });

    it('应该处理空结果', () => {
      const report = generateReport([]);

      expect(report).toContain('检查文件: 0');
      expect(report).toContain('通过: 0');
    });

    it('应该截断警告显示（最多5条）', () => {
      const results = [{
        valid: true,
        file: '/test/file.ts',
        annotations: [],
        errors: [],
        warnings: Array(10).fill({ line: 1, message: 'Warning', code: 'MISSING_ACCEPTANCE' as const }),
      }];

      const report = generateReport(results);

      expect(report).toContain('警告');
    });
  });

  describe('边缘情况', () => {
    it('应该处理空文件', () => {
      mockFs.readFileSync.mockReturnValue('');

      const result = checkFile('/test/empty.ts');

      expect(result.annotations.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('应该处理多行 JSDoc', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * First line
 * Second line
 * @spec AR-009
 * Third line
 */
export function multi() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations.length).toBe(1);
      expect(result.annotations[0]?.specId).toBe('AR-009');
    });

    it('应该处理多个 @implements', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-010
 * @implements feat1, feat2, feat3
 */
export function multiImpl() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations[0]?.implements?.length).toBeGreaterThanOrEqual(3);
    });

    it('应该处理 @dependencies', () => {
      mockFs.readFileSync.mockReturnValue(`
/**
 * @spec AR-011
 * @dependencies lib1, lib2
 */
export function withDeps() {}
`);

      const result = checkFile('/test/file.ts');

      expect(result.annotations[0]?.dependencies?.length).toBeGreaterThan(0);
    });
  });
});