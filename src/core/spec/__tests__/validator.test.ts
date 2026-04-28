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
  });
});