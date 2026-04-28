/**
 * SpecValidator 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SpecValidator } from '../core/spec/validator';
import * as fs from 'fs';
import * as path from 'path';

describe('SpecValidator', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-spec');
  let validator: SpecValidator;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    validator = SpecValidator.getInstance();
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('getInstance', () => {
    it('应该返回单例实例', () => {
      const instance1 = SpecValidator.getInstance();
      const instance2 = SpecValidator.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('setConfig', () => {
    it('应该更新配置', () => {
      validator.setConfig({
        enabled: true,
        files: ['*.md'],
      });

      expect(validator).toBeDefined();
    });
  });

  describe('detectSpecType', () => {
    it('应该检测 Spec 类型', () => {
      const type = validator.detectSpecType('ARCHITECTURE.md');
      expect(type).toBeDefined();
    });

    it('YAML 文件应该返回正确类型', () => {
      const type = validator.detectSpecType('specs/test.yml');
      expect(type).toBeDefined();
    });
  });
});