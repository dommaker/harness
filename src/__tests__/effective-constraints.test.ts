/**
 * 生效约束集（getEffectiveConstraints / lintEffectiveConfig）测试
 *
 * 合并矩阵（ADR-0029）：preset 裁剪 / config.yml 禁用 / 未知 id 诊断
 * （custom 追加与 scenes 过滤已随文本注入层关停一并退役）
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import {
  getEffectiveConstraints,
  lintEffectiveConfig,
} from '../core/effective-constraints';
import { createProjectFixture } from '../test-setup/project-fixture';
import { CONSTRAINTS } from '../core/constraints/definitions';

const BUILTIN_TOTAL = Object.keys(CONSTRAINTS).length;

describe('getEffectiveConstraints / lintEffectiveConfig', () => {
  let tempDir: string;
  let counter = 0;

  const setupProject = (configYaml?: string): string =>
    createProjectFixture({
      parentDir: tempDir,
      name: `p${counter++}`,
      config: configYaml,
    });

  beforeEach(() => {
    // cwd 锚定套件：parentDir 显式 opt-out，缺省 tmpdir 会改变路径锚定结论（harness#90）
    tempDir = createProjectFixture({ name: 'temp-test-effective', parentDir: process.cwd() });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('合并矩阵', () => {
    it('无配置项目：内置全集（全部 kind=check，带 severity）', () => {
      const dir = setupProject();
      const constraints = getEffectiveConstraints(dir);

      expect(constraints.length).toBe(BUILTIN_TOTAL);
      expect(constraints.every(c => c.kind === 'check')).toBe(true);
    });

    it('config.yml 禁用：条目从生效集移除', () => {
      const dir = setupProject(`
constraints:
  capability_sync:
    enabled: false
  docs_freshness:
    enabled: false
`);
      const constraints = getEffectiveConstraints(dir);
      const ids = constraints.map(c => c.id);

      expect(ids).not.toContain('capability_sync');
      expect(ids).not.toContain('docs_freshness');
      expect(constraints.length).toBe(BUILTIN_TOTAL - 2);
    });

    it('preset: relaxed 裁剪生效集', () => {
      const dir = setupProject(`preset: relaxed\n`);
      const constraints = getEffectiveConstraints(dir);
      const ids = constraints.map(c => c.id);

      expect(ids).toEqual(
        expect.arrayContaining([
          'no_completion_without_verification',
          'no_hardcoded_credentials',
        ])
      );
      expect(constraints).toHaveLength(2);
      expect(constraints.every(c => c.kind === 'check')).toBe(true);
    });

    it('禁用未知 id（已移除约束的残留配置）：不报错，lint 可诊断', () => {
      const dir = setupProject(`
constraints:
  removed_legacy_constraint:
    enabled: false
`);
      // 生效集不受影响、不抛错
      const constraints = getEffectiveConstraints(dir);
      expect(constraints.length).toBe(BUILTIN_TOTAL);

      const lint = lintEffectiveConfig(dir);
      expect(lint.unknownIds).toContain('removed_legacy_constraint');
    });

    it('lintEffectiveConfig：干净配置 unknownIds 为空', () => {
      const dir = setupProject();
      const lint = lintEffectiveConfig(dir);

      expect(lint.unknownIds).toEqual([]);
    });
  });
});
