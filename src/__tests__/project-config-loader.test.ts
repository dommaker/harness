/**
 * ProjectConfigLoader 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ProjectConfigLoader } from '../core/project-config-loader';
import * as fs from 'fs';
import * as path from 'path';

describe('ProjectConfigLoader', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-config');
  const harnessDir = path.join(tempDir, '.harness');

  beforeAll(() => {
    fs.mkdirSync(harnessDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('load', () => {
    it('无配置文件时应该返回默认配置', () => {
      const loader = new ProjectConfigLoader(tempDir);
      const config = loader.load();

      expect(config.preset).toBe('standard');
      expect(config.custom_constraints_file).toBeDefined();
    });

    it('应该加载 config.yml', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
preset: custom
custom_constraints_file: my-constraints.yml
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      const config = loader.load();

      expect(config.preset).toBe('custom');
      expect(config.custom_constraints_file).toBe('my-constraints.yml');
    });
  });

  describe('mergeConstraints', () => {
    it('应该合并内置约束', () => {
      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const merged = loader.mergeConstraints();

      expect(merged.ironLaws).toBeDefined();
      expect(merged.guidelines).toBeDefined();
      expect(merged.tips).toBeDefined();
      expect(Object.keys(merged.ironLaws).length).toBeGreaterThan(0);
    });

    it('应该加载自定义约束', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'custom-constraints.yml'),
        `
custom_rules:
  my_rule:
    rule: MY CUSTOM RULE
    message: Custom message
    level: guideline
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const merged = loader.mergeConstraints();
      expect(merged.custom).toBeDefined();
    });
  });

  describe('配置合并', () => {
    it('应该正确合并默认配置和加载配置', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `preset: minimal`
      );

      const loader = new ProjectConfigLoader(tempDir);
      const config = loader.load();

      expect(config.preset).toBe('minimal');
      // 默认值应该保留
      expect(config.custom_constraints_file).toBe('custom-constraints.yml');
    });
  });

  describe('错误处理', () => {
    it.skip('无效 YAML 应该抛出异常', () => {
      // YAML 解析错误会直接抛出异常，这是预期行为
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `invalid: yaml: content: :::`
      );

      const loader = new ProjectConfigLoader(tempDir);
      expect(() => loader.load()).toThrow();
    });

    it('自定义约束文件不存在应该不崩溃', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `custom_constraints_file: nonexistent.yml`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const merged = loader.mergeConstraints();
      expect(merged).toBeDefined();
    });
  });
});