/**
 * ProjectConfigLoader 补充测试
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { ProjectConfigLoader, isConstraintRetired } from '../core/project-config-loader';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectConfigLoader - 补充覆盖', () => {
  let tempDir: string;
  let harnessDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-config-extra-'));
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

  describe('零消费者收缩（harness#137）', () => {
    /**
     * `isConstraintEnabled` / `getConstraintSource` 属 ADR-0022 型漏收：
     * 除本文件与自身测试外双仓零消费者，生效集判定唯一来源是
     * `mergeConstraints` → `getEffectiveConstraints`（ADR-0001），这两个查询函数是它的平行复印。
     */
    it('isConstraintEnabled / getConstraintSource 已从类面删除', () => {
      const loader = new ProjectConfigLoader(tempDir);
      loader.load();

      // @ts-expect-error isConstraintEnabled 零消费者，随 harness#137 删除
      expect(loader.isConstraintEnabled).toBeUndefined();
      // @ts-expect-error getConstraintSource 零消费者，随 harness#137 删除
      expect(loader.getConstraintSource).toBeUndefined();
      expect(ProjectConfigLoader.prototype).not.toHaveProperty('isConstraintEnabled');
      expect(ProjectConfigLoader.prototype).not.toHaveProperty('getConstraintSource');
    });
  });

  describe('isConstraintRetired（退役判定单点，harness#137）', () => {
    it('config.yml enabled:false 即已退役，与 custom 条目无关', () => {
      expect(isConstraintRetired(undefined, true)).toBe(true);
    });

    it('custom 条目带 retired 元数据即已退役（studio#82 D6 落点在条目自身）', () => {
      expect(isConstraintRetired({ retired: { at: '2026-08-08T12:00:00.000Z' } }, false)).toBe(true);
    });

    it('两个落点都没命中 → 未退役', () => {
      expect(isConstraintRetired(undefined, false)).toBe(false);
      expect(isConstraintRetired({ retired: undefined }, false)).toBe(false);
    });

    it('retired 段的假值（null / 空串）不算退役——mergeConstraints 用的是 truthiness', () => {
      expect(isConstraintRetired({ retired: null }, false)).toBe(false);
      expect(isConstraintRetired({ retired: '' }, false)).toBe(false);
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

  describe('preset 裁剪（内联自原 applyPreset）', () => {
    it('options.preset 覆盖 config.yml 的 preset', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `preset: standard`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints({ preset: 'relaxed' });

      // relaxed 仅启用 3 条铁律 + 2 条指导原则，禁用提示
      expect(Object.keys(merged.ironLaws)).toHaveLength(3);
      expect(Object.keys(merged.guidelines)).toHaveLength(2);
      expect(Object.keys(merged.prompts ?? {})).toHaveLength(0);
      expect(merged.disabled.length).toBeGreaterThan(0);
    });

    it('未知预设名回落 standard + stderr 警告', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `preset: no_such_preset`
      );

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const loader = new ProjectConfigLoader(tempDir);
        loader.load();
        const merged = loader.mergeConstraints();

        // 回落 standard = 全部启用
        expect(merged.disabled).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('未知预设 "no_such_preset"')
        );
      } finally {
        errorSpy.mockRestore();
      }
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