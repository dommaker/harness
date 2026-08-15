/**
 * ProjectConfigLoader 补充测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ProjectConfigLoader } from '../core/project-config-loader';
import * as fs from 'fs';
import * as path from 'path';

describe('ProjectConfigLoader - 补充覆盖', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-config-extra');
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

  describe('禁用约束', () => {
    it('应该禁用指定约束', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
constraints:
  legacy_disabled_a:
    enabled: false
  legacy_disabled_b:
    enabled: false
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints();

      expect(merged.disabled).toContain('legacy_disabled_a');
      expect(merged.disabled).toContain('legacy_disabled_b');
    });
  });

  describe('自定义约束层级', () => {
    it('应该正确分类 iron_law 级别约束', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  my_iron_law:
    rule: MY IRON LAW
    message: Iron law message
    level: iron_law
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints();

      expect(merged.ironLaws['my_iron_law']).toBeDefined();
    });

    it('默认应该分类为 guideline', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  my_guideline:
    rule: MY GUIDELINE
    message: Guideline message
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints();

      expect(merged.guidelines['my_guideline']).toBeDefined();
    });
  });

  describe('自定义约束 promptInjection', () => {
    it('应该透传 promptInjection 并进入注入段渲染', async () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  my_prompt_rule:
    rule: MY PROMPT RULE
    message: Prompt rule message
    level: guideline
    trigger: commit
    promptInjection: 我的自定义注入文本
  my_silent_rule:
    rule: MY SILENT RULE
    message: No injection text
    level: guideline
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints();

      // 字段透传
      expect(merged.guidelines['my_prompt_rule']?.promptInjection).toBe('我的自定义注入文本');
      // 未定义 promptInjection 的自定义约束保持不注入（与内置无注入文本条目一致）
      expect(merged.guidelines['my_silent_rule']?.promptInjection).toBeUndefined();

      // 端到端：进入 CLAUDE.md 注入段渲染
      const { renderConstraintsSection } = await import('../core/constraints/injection-renderer');
      const section = renderConstraintsSection(Object.values(merged.guidelines), '0.0.0-test');
      expect(section).toContain('- **my_prompt_rule**: 我的自定义注入文本');
      expect(section).not.toContain('my_silent_rule');
    });
  });

  describe('约束扩展', () => {
    it('应该扩展例外列表', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  extended_rule:
    rule: EXTENDED RULE
    message: Extended
    level: guideline
    trigger: commit
    exceptions:
      - simple_typo
    extend_exceptions:
      - config_change
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints();

      expect(merged.guidelines['extended_rule']?.exceptions).toBeDefined();
      expect(merged.guidelines['extended_rule']?.exceptions).toContain('simple_typo');
      expect(merged.guidelines['extended_rule']?.exceptions).toContain('config_change');
    });
  });

  describe('isConstraintEnabled', () => {
    it('启用的约束应该返回 true', () => {
      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.isConstraintEnabled('no_bypass_checkpoint')).toBe(true);
    });

    it('禁用的约束应该返回 false', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
constraints:
  test_disabled:
    enabled: false
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.isConstraintEnabled('test_disabled')).toBe(false);
    });
  });

  describe('getConstraintSource', () => {
    it('内置约束应该返回 built-in', () => {
      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.getConstraintSource('no_bypass_checkpoint')).toBe('built-in');
    });

    it('自定义约束应该返回 custom', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  custom_source_test:
    rule: CUSTOM
    message: Custom
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.getConstraintSource('custom_source_test')).toBe('custom');
    });

    it('禁用约束应该返回 disabled', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
constraints:
  source_disabled:
    enabled: false
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.getConstraintSource('source_disabled')).toBe('disabled');
    });
  });

  describe('hasCustomConfig', () => {
    it('无自定义配置应该返回 false', () => {
      // 清空配置
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `preset: standard`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.hasCustomConfig()).toBe(false);
    });

    it('有自定义约束应该返回 true', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  custom_for_has:
    rule: CUSTOM
    message: Custom
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      expect(loader.hasCustomConfig()).toBe(true);
    });
  });

  describe('getConfig', () => {
    it('应该返回当前配置', () => {
      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const config = loader.getConfig();
      expect(config).toBeDefined();
      expect(config.preset).toBeDefined();
    });
  });

  describe('getCustomConstraints', () => {
    it('应该返回自定义约束', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
custom_constraints:
  get_custom_test:
    rule: TEST
    message: Test
    trigger: commit
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      const customs = loader.getCustomConstraints();
      expect(customs['get_custom_test']).toBeDefined();
    });
  });
});