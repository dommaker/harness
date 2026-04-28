/**
 * AnnotationChecker 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { checkFile, checkDirectory } from '../spec/annotation-checker';
import * as fs from 'fs';
import * as path from 'path';

describe('AnnotationChecker', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-annotations');
  const validFile = path.join(tempDir, 'valid.ts');
  const invalidFile = path.join(tempDir, 'invalid.ts');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    
    // 创建有效文件
    fs.writeFileSync(validFile, `
/**
 * @spec AR-001
 * @implements AR-001-C1
 * @acceptance AC-001
 * @author test
 * @since 2026-01-01
 */
export class ValidClass {
  /**
   * @spec AR-001-S1
   */
  validMethod() {}
}
`);

    // 创建无效文件（缺少必要字段）
    fs.writeFileSync(invalidFile, `
/**
 * @spec invalid-id
 */
export class InvalidClass {
  method() {}
}
`);
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('checkFile', () => {
    it('应该检查有效文件', () => {
      const result = checkFile(validFile);

      expect(result.annotations.length).toBeGreaterThan(0);
      // 可能有关键字段缺失的警告，但不应该有错误
    });

    it('应该检查无效文件', () => {
      const result = checkFile(invalidFile);

      expect(result.annotations.length).toBeGreaterThan(0);
      // Spec ID 格式不正确应该报错
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('应该解析 Spec ID', () => {
      const result = checkFile(validFile);

      const annotation = result.annotations[0];
      expect(annotation.specId).toBe('AR-001');
    });

    it('应该解析 implements 字段', () => {
      const result = checkFile(validFile);

      const annotation = result.annotations[0];
      expect(annotation.implements).toBeDefined();
      expect(annotation.implements?.length).toBeGreaterThan(0);
    });

    it('应该解析 acceptance 字段', () => {
      const result = checkFile(validFile);

      const annotation = result.annotations[0];
      expect(annotation.acceptance).toBeDefined();
    });

    it('应该解析行号', () => {
      const result = checkFile(validFile);

      expect(result.annotations[0].line).toBeGreaterThan(0);
    });

    it('文件不存在应该抛出异常', () => {
      expect(() => checkFile('/nonexistent/file.ts')).toThrow();
    });
  });

  describe('checkDirectory', () => {
    it('应该检查目录中的所有文件', () => {
      const results = checkDirectory(tempDir);

      expect(results.length).toBeGreaterThan(0);
    });

    it('应该返回每个文件的结果', () => {
      const results = checkDirectory(tempDir);

      expect(results.some(r => r.file.includes('valid.ts'))).toBe(true);
      expect(results.some(r => r.file.includes('invalid.ts'))).toBe(true);
    });

    it('空目录应该返回空数组', () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      const results = checkDirectory(emptyDir);

      expect(results.length).toBe(0);
    });
  });

  describe('Spec ID 格式验证', () => {
    it('有效 Spec ID 应该通过', () => {
      const validSpecFile = path.join(tempDir, 'spec-valid.ts');
      fs.writeFileSync(validSpecFile, `
/**
 * @spec WS-001
 */
export class Test {}
`);

      const result = checkFile(validSpecFile);
      expect(result.errors.some(e => e.code === 'INVALID_SPEC_FORMAT')).toBe(false);
    });

    it('无效 Spec ID 应该报错', () => {
      const invalidSpecFile = path.join(tempDir, 'spec-invalid.ts');
      fs.writeFileSync(invalidSpecFile, `
/**
 * @spec INVALID
 */
export class Test {}
`);

      const result = checkFile(invalidSpecFile);
      expect(result.errors.some(e => e.code === 'INVALID_SPEC_FORMAT')).toBe(true);
    });
  });

  describe('警告', () => {
    it('缺少 implements 应该警告', () => {
      const warnFile = path.join(tempDir, 'warn.ts');
      fs.writeFileSync(warnFile, `
/**
 * @spec AR-001
 */
export class WarnClass {}
`);

      const result = checkFile(warnFile);
      expect(result.warnings.some(w => w.code === 'MISSING_IMPLEMENTS')).toBe(true);
    });

    it('缺少 acceptance 应该警告', () => {
      const warnFile = path.join(tempDir, 'warn2.ts');
      fs.writeFileSync(warnFile, `
/**
 * @spec AR-001
 * @implements AR-001-C1
 */
export class WarnClass2 {}
`);

      const result = checkFile(warnFile);
      expect(result.warnings.some(w => w.code === 'MISSING_ACCEPTANCE')).toBe(true);
    });
  });
});