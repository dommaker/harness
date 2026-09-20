/**
 * ProjectConfigLoader 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ProjectConfigLoader, getCapabilitiesMode } from '../core/project-config-loader';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectConfigLoader', () => {
  let tempDir: string;
  let harnessDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-config-'));
    harnessDir = path.join(tempDir, '.harness');
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
    });

    it('应该加载 config.yml', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `preset: custom`
      );

      const loader = new ProjectConfigLoader(tempDir);
      const config = loader.load();

      expect(config.preset).toBe('custom');
    });
  });

  describe('mergeConstraints', () => {
    it('应该合并内置约束', () => {
      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const merged = loader.mergeConstraints();

      expect(merged.constraints).toBeDefined();
      expect(Object.keys(merged.constraints).length).toBeGreaterThan(0);
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

    it('config.yml 只有无关键时 mergeConstraints 不崩溃', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `preset: standard`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const merged = loader.mergeConstraints();
      expect(merged).toBeDefined();
    });
  });

  describe('getCapabilitiesMode', () => {
    /** 建一个带独立 .harness/config.yml 的临时项目目录（各用例独占自己的配置内容） */
    const setupConfigDir = (name: string, configYaml: string): string => {
      const dir = path.join(tempDir, name);
      fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.harness', 'config.yml'), configYaml);
      return dir;
    };

    it('未配置时缺省返回 file', () => {
      const dir = setupConfigDir('caps-default', `preset: standard`);
      expect(getCapabilitiesMode(dir)).toBe('file');
    });

    it('mode: module 应该返回 module', () => {
      const dir = setupConfigDir(
        'caps-module',
        `governance:\n  capabilities:\n    mode: module`
      );
      expect(getCapabilitiesMode(dir)).toBe('module');
    });

    it('mode: listing 应该返回 listing', () => {
      const dir = setupConfigDir(
        'caps-listing',
        `governance:\n  capabilities:\n    mode: listing`
      );
      expect(getCapabilitiesMode(dir)).toBe('listing');
    });

    it('非法取值应该回落 file', () => {
      const dir = setupConfigDir(
        'caps-invalid',
        `governance:\n  capabilities:\n    mode: bogus`
      );
      expect(getCapabilitiesMode(dir)).toBe('file');
    });
  });
});