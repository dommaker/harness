/**
 * ProjectConfigLoader 补充测试
 *
 * ADR-0029：custom 纯文本约束面（custom_constraints / getCustomConstraints /
 * isConstraintRetired 的 custom 落点）已随文本注入层关停一并退役，相关用例移除。
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { ProjectConfigLoader } from '../core/project-config-loader';
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
    it('未知 id 的禁用配置静默忽略（生效集不变）', () => {
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

      // 未知 id 进 unknownIds 供诊断（filterEnabledEntries 历史口径：未知但 enabled:false 的 id 同时也进 disabled）
      expect(merged.unknownIds).toContain('legacy_disabled_a');
      expect(merged.unknownIds).toContain('legacy_disabled_b');
    });

    it('内置 id 的禁用配置从生效集移除并进 disabled', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
constraints:
  capability_sync:
    enabled: false
`
      );

      const loader = new ProjectConfigLoader(tempDir);
      loader.load();
      const merged = loader.mergeConstraints();

      expect(merged.disabled).toContain('capability_sync');
      expect(merged.constraints['capability_sync']).toBeUndefined();
    });
  });

  describe('零消费者收缩（harness#137）', () => {
    /**
     * `isConstraintEnabled` / `getConstraintSource` 属 ADR-0022 型漏收：
     * 除本文件与自身测试外双仓零消费者，生效集判定唯一来源是
     * `mergeConstraints` → `getEffectiveConstraints`，这两个查询函数是它的平行复印。
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

    it('有 constraints 段应该返回 true', () => {
      fs.writeFileSync(
        path.join(harnessDir, 'config.yml'),
        `
constraints:
  capability_sync:
    enabled: false
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

      // relaxed 仅启用 1 条 error 级 + 1 条 warning 级
      expect(Object.keys(merged.constraints)).toHaveLength(2);
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
});
