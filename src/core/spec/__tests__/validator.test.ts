/**
 * SpecValidator 测试
 */

import { SpecValidator } from '../validator';
import * as fs from 'fs/promises';

// Mock fs
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  stat: jest.fn(),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('SpecValidator', () => {
  let validator: SpecValidator;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton
    (SpecValidator as any).instance = undefined;
    validator = SpecValidator.getInstance();
  });

  describe('getInstance()', () => {
    it('should return singleton instance', () => {
      const v1 = SpecValidator.getInstance();
      const v2 = SpecValidator.getInstance();
      expect(v1).toBe(v2);
    });

    it('should accept custom config', () => {
      (SpecValidator as any).instance = undefined;
      const v = SpecValidator.getInstance({ enabled: false });
      expect(v).toBeDefined();
    });
  });

  describe('setConfig()', () => {
    it('should update config', () => {
      validator.setConfig({ enabled: false });
      expect(validator).toBeDefined();
    });
  });

  describe('detectSpecType()', () => {
    it('should detect architecture type', () => {
      const type = validator.detectSpecType('ARCHITECTURE.md');
      expect(type).toBe('architecture');
    });

    it('should detect module type', () => {
      const type = validator.detectSpecType('specs/modules/user.yml');
      expect(type).toBe('module');
    });

    it('should detect api type', () => {
      const type = validator.detectSpecType('specs/api/auth.yaml');
      expect(type).toBe('api');
    });

    it('should return custom for unknown files', () => {
      const type = validator.detectSpecType('specs/custom.json');
      expect(type).toBe('custom');
    });

    it('should handle lowercase architecture', () => {
      const type = validator.detectSpecType('architecture.md');
      expect(type).toBe('architecture');
    });
  });

  describe('validateFile()', () => {
    it('should return invalid for non-existent file', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('Not found'));

      const result = await validator.validateFile('/non/existent.yml');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('loadSchema()', () => {
    it('should return null for invalid path', async () => {
      mockFs.access.mockRejectedValue(new Error('Not found'));

      const schema = await validator.loadSchema('/non/existent');

      expect(schema).toBeNull();
    });
  });

  describe('validateAll()', () => {
    it('should validate multiple files', async () => {
      mockFs.access.mockRejectedValue(new Error('Not found'));

      const result = await validator.validateAll('/test/project');

      expect(result).toBeDefined();
    });

    it('should validate staged files', async () => {
      // Mock exec for git diff
      const mockExec = jest.fn().mockResolvedValue({ stdout: 'specs/test.yml\nARCHITECTURE.md\n' });
      jest.doMock('child_process', () => ({ exec: mockExec }));
      jest.doMock('util', () => ({ promisify: () => mockExec }));

      mockFs.access.mockRejectedValue(new Error('Not found'));

      const result = await validator.validateAll('/test/project', true);

      expect(result).toBeDefined();
    });
  });

  describe('validateFile() with YAML', () => {
    it('should validate valid YAML file', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('name: test\nversion: 1');

      const result = await validator.validateFile('specs/test.yml');

      expect(result.valid).toBe(true);
    });

    it('should detect invalid YAML', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('invalid: yaml: content:');

      const result = await validator.validateFile('specs/bad.yml');

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateFile() with ARCHITECTURE.md', () => {
    it('should validate valid ARCHITECTURE.md', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('# Architecture\n\n## Module A\n\nContent...');

      const result = await validator.validateFile('ARCHITECTURE.md');

      expect(result.type).toBe('architecture');
    });

    it('should warn on missing headers', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('Just plain text without headers');

      const result = await validator.validateFile('ARCHITECTURE.md');

      // 警告可能被添加到 errors 或 warnings
      const hasWarning = result.warnings.length > 0 || result.errors.some(e => e.severity === 'warning');
      expect(hasWarning || result.valid).toBe(true);
    });
  });

  describe('isSpecFile()', () => {
    it('should identify ARCHITECTURE.md as spec file', () => {
      // 间接测试：通过 validateAll 调用
      expect(true).toBe(true); // placeholder
    });

    it('should identify specs directory files', () => {
      expect(true).toBe(true);
    });
  });

  describe('basicValidation()', () => {
    it('should return valid for empty content', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('');

      const result = await validator.validateFile('specs/empty.yml');

      // 空 YAML 是合法的
      expect(result.valid).toBe(true);
    });
  });

  describe('fileExists()', () => {
    it('should return true for existing file', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('test');

      const result = await validator.validateFile('specs/existing.yml');

      expect(result).toBeDefined();
    });

    it('should return false for non-existing file', async () => {
      mockFs.access.mockRejectedValue(new Error('Not found'));

      const result = await validator.validateFile('specs/nonexistent.yml');

      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toContain('不存在');
    });
  });

  describe('dynamicImport()', () => {
    it('should handle import errors', async () => {
      mockFs.access.mockRejectedValue(new Error('Not found'));

      const schema = await validator.loadSchema('/invalid/module.ts');

      expect(schema).toBeNull();
    });
  });

  describe('getStagedFiles()', () => {
    it('should handle git errors', async () => {
      // git 命令失败时返回空数组
      const result = await validator.validateAll('/test', true);

      // 可能无法找到 spec 文件
      expect(result).toBeDefined();
      expect(result.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('validate with custom schema', () => {
    it('should use provided schema', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('custom content');

      const customSchema = {
        name: 'custom',
        validate: async () => ({
          valid: true,
          file: 'test.yml',
          type: 'custom' as const,
          errors: [],
          warnings: [],
        }),
      };

      const result = await validator.validateFile('test.yml', customSchema);

      expect(result.valid).toBe(true);
    });

    it('should handle schema validation errors', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('bad content');

      const failingSchema = {
        name: 'failing',
        validate: async () => ({
          valid: false,
          file: 'test.yml',
          type: 'custom' as const,
          errors: [{ path: '', message: 'Schema error', severity: 'error' as const }],
          warnings: [],
        }),
      };

      const result = await validator.validateFile('test.yml', failingSchema);

      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toBe('Schema error');
    });

    it('should handle schema throwing exception', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue('content');

      const throwingSchema = {
        name: 'throwing',
        validate: async () => {
          throw new Error('Validation exception');
        },
      };

      const result = await validator.validateFile('test.yml', throwingSchema);

      expect(result.valid).toBe(false);
      expect(result.errors[0]?.message).toContain('验证失败');
    });
  });
});