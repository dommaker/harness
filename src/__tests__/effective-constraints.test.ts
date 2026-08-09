/**
 * 生效约束集（getEffectiveConstraints / lintEffectiveConfig）测试
 *
 * 合并矩阵：preset 裁剪 / config.yml 禁用 / custom 追加 / scenes 过滤 / 未知 id 诊断
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  getEffectiveConstraints,
  lintEffectiveConfig,
} from '../core/effective-constraints';
import { IRON_LAWS, GUIDELINES, PROMPTS } from '../core/constraints/definitions';

const BUILTIN_TOTAL =
  Object.keys(IRON_LAWS).length + Object.keys(GUIDELINES).length + Object.keys(PROMPTS).length;
/** 带 appliesTo 标签的内置 prompt（scenes 过滤对象） */
const SCENE_PROMPTS = Object.values(PROMPTS)
  .filter(c => c.appliesTo && c.appliesTo.length > 0)
  .map(c => c.id);

describe('getEffectiveConstraints / lintEffectiveConfig', () => {
  let tempDir: string;
  let counter = 0;

  const setupProject = (configYaml?: string, customYaml?: string): string => {
    const dir = path.join(tempDir, `p${counter++}`);
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    if (configYaml !== undefined) {
      fs.writeFileSync(path.join(dir, '.harness', 'config.yml'), configYaml);
    }
    if (customYaml !== undefined) {
      fs.writeFileSync(path.join(dir, '.harness', 'custom-constraints.yml'), customYaml);
    }
    return dir;
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-effective-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('合并矩阵', () => {
    it('无配置项目：内置全集减去场景专属 prompt（scenes 缺省为空）', () => {
      const dir = setupProject();
      const constraints = getEffectiveConstraints(dir);
      const ids = constraints.map(c => c.id);

      expect(constraints.length).toBe(BUILTIN_TOTAL - SCENE_PROMPTS.length);
      for (const id of SCENE_PROMPTS) {
        expect(ids).not.toContain(id);
      }
      // check + prompt 均带 kind
      expect(constraints.every(c => c.kind === 'check' || c.kind === 'prompt')).toBe(true);
      expect(constraints.filter(c => c.kind === 'check')).toHaveLength(
        Object.keys(IRON_LAWS).length + Object.keys(GUIDELINES).length
      );
    });

    it('scenes 命中：对应场景 prompt 进入生效集，其余场景 prompt 仍排除', () => {
      const dir = setupProject(`scenes:\n  - agent-skill\n`);
      const ids = getEffectiveConstraints(dir).map(c => c.id);

      expect(ids).toContain('no_skill_without_test');
      expect(ids).not.toContain('no_model_for_deterministic');
    });

    it('config.yml 禁用：check 与 prompt 条目均从生效集移除', () => {
      const dir = setupProject(`
constraints:
  no_bypass_checkpoint:
    enabled: false
  no_fuzzy_completion_claim:
    enabled: false
`);
      const constraints = getEffectiveConstraints(dir);
      const ids = constraints.map(c => c.id);

      expect(ids).not.toContain('no_bypass_checkpoint');
      expect(ids).not.toContain('no_fuzzy_completion_claim');
      expect(constraints.length).toBe(BUILTIN_TOTAL - SCENE_PROMPTS.length - 2);
    });

    it('preset: relaxed 裁剪生效集', () => {
      const dir = setupProject(`preset: relaxed\n`);
      const constraints = getEffectiveConstraints(dir);
      const ids = constraints.map(c => c.id);

      expect(ids).toEqual(
        expect.arrayContaining([
          'no_completion_without_verification',
          'incremental_progress',
          'no_implementation_without_requirement',
          'no_bypass_checkpoint',
          'no_hardcoded_credentials',
        ])
      );
      expect(constraints).toHaveLength(5);
      expect(constraints.every(c => c.kind === 'check')).toBe(true);
    });

    it('custom-constraints.yml 追加自定义约束（kind=prompt）', () => {
      const dir = setupProject(undefined, `
custom_constraints:
  my_project_rule:
    level: guideline
    rule: MY RULE
    message: 项目自定义
    trigger: code_implementation
`);
      const constraints = getEffectiveConstraints(dir);
      const custom = constraints.find(c => c.id === 'my_project_rule');

      expect(custom).toBeDefined();
      expect(custom!.kind).toBe('prompt');
      expect(custom!.level).toBe('guideline');
    });

    it('禁用未知 id（已移除约束的残留配置）：不报错，lint 可诊断', () => {
      const dir = setupProject(`
constraints:
  removed_legacy_constraint:
    enabled: false
`);
      // 生效集不受影响、不抛错
      const constraints = getEffectiveConstraints(dir);
      expect(constraints.length).toBe(BUILTIN_TOTAL - SCENE_PROMPTS.length);

      const lint = lintEffectiveConfig(dir);
      expect(lint.unknownIds).toContain('removed_legacy_constraint');
    });

    it('lintEffectiveConfig 报告 scenes 与被场景过滤的 prompt', () => {
      const dir = setupProject(`scenes:\n  - llm-app\n`);
      const lint = lintEffectiveConfig(dir);

      expect(lint.scenes).toEqual(['llm-app']);
      expect(lint.sceneExcluded).toContain('no_skill_without_test');
      expect(lint.sceneExcluded).not.toContain('no_model_for_deterministic');
      expect(lint.unknownIds).toEqual([]);
    });
  });
});
