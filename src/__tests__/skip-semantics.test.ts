/**
 * skip 三态语义测试（ADR-0001 P4）
 *
 * 覆盖：
 * - 三条存在性探测（capability_sync / context_doc_sync / docs_freshness）有/无约定两路
 * - flag 型铁律 undefined → skip（显式 false 仍 fail，true 仍 pass）
 * - Iron Law skip 不阻断 checkConstraints
 * - detectTrigger 代码文件 → 附加 code_implementation 推断
 * - trace 记录 result: 'skip'；TraceAnalyzer 的 pass/fail 率分母不计 skip
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import { ConstraintChecker } from '../core/constraints/checker';
import { detectTrigger, buildConstraintContext } from '../core/constraints/context-builder';
import { IRON_LAWS } from '../core/constraints/definitions';
import { TraceAnalyzer } from '../monitoring/trace-analyzer';
import type { Constraint, ConstraintContext } from '../types/constraint';
import type { ExecutionTrace } from '../types/trace';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const checker = ConstraintChecker.getInstance();

function makeConstraint(
  id: string,
  level: 'iron_law' | 'guideline',
  trigger: string = 'commit'
): Constraint {
  return { id, kind: 'check', level, rule: 'TEST', message: 'test', trigger, enforcement: 'test' };
}

describe('skip 三态语义（ADR-0001）', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-skip-semantics');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, 'initial.txt'), 'initial');
    execSync('git add .', { cwd: tempDir });
    execSync('git commit -m "init"', { cwd: tempDir });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    // 复位 trace recorder，避免泄漏到其他用例
    checker.setTraceRecorder({ record: () => undefined });
  });

  describe('capability_sync 存在性探测', () => {
    it('无 CAPABILITIES.md（未采用约定）→ skip，不计 fail', async () => {
      const dir = path.join(tempDir, 'cap-skip');
      fs.mkdirSync(dir, { recursive: true });

      const result = await checker.check(makeConstraint('capability_sync', 'guideline'), {
        operation: 'commit',
        projectPath: dir,
      } as ConstraintContext);

      expect(result.skipped).toBe(true);
      expect(result.satisfied).toBe(true); // fail-open：skip 不产生违规

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('有 CAPABILITIES.md（采用约定）→ 正常评估，非 skip', async () => {
      const dir = path.join(tempDir, 'cap-adopted');
      fs.mkdirSync(dir, { recursive: true });
      // 散文文档（无表格）历史放行；此处只验证"进入评估"而非 skip
      fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), '# Capabilities\n\n- Feature: test');

      const result = await checker.check(makeConstraint('capability_sync', 'guideline'), {
        operation: 'commit',
        projectPath: dir,
      } as ConstraintContext);

      expect(result.skipped).toBeUndefined();
      expect(result.satisfied).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('context_doc_sync 存在性探测', () => {
    it('无 context_files 配置（未采用约定）→ skip', async () => {
      const dir = path.join(tempDir, 'ctx-skip');
      fs.mkdirSync(dir, { recursive: true });

      const result = await checker.check(makeConstraint('context_doc_sync', 'guideline'), {
        operation: 'module_modification',
        projectPath: dir,
      } as ConstraintContext);

      expect(result.skipped).toBe(true);
      expect(result.satisfied).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('配置了 required_dirs 且缺少 CONTEXT.md → fail（非 skip）', async () => {
      const dir = path.join(tempDir, 'ctx-fail');
      fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

      const yaml = require('js-yaml');
      fs.writeFileSync(
        path.join(dir, '.harness', 'config.yml'),
        yaml.dump({ governance: { context_files: { enabled: true, required_dirs: ['src'] } } })
      );

      const result = await checker.check(makeConstraint('context_doc_sync', 'guideline'), {
        operation: 'module_modification',
        projectPath: dir,
      } as ConstraintContext);

      expect(result.skipped).toBeUndefined();
      expect(result.satisfied).toBe(false);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('docs_freshness 存在性探测', () => {
    it('无任何 freshness 配置/目标 → skip', async () => {
      const dir = path.join(tempDir, 'fresh-skip');
      fs.mkdirSync(dir, { recursive: true });

      const result = await checker.check(makeConstraint('docs_freshness', 'iron_law', 'file_modification'), {
        operation: 'file_modification',
        projectPath: dir,
      } as ConstraintContext);

      expect(result.skipped).toBe(true);
      expect(result.satisfied).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('有 CAPABILITIES.md 目标 → 正常评估（幽灵条目仍 fail，非 skip）', async () => {
      const dir = path.join(tempDir, 'fresh-adopted');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| ghost | src/ghost.ts | 不存在 |'
      );

      const result = await checker.check(makeConstraint('docs_freshness', 'iron_law', 'file_modification'), {
        operation: 'file_modification',
        projectPath: dir,
      } as ConstraintContext);

      expect(result.skipped).toBeUndefined();
      expect(result.satisfied).toBe(false);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('flag 型铁律：undefined → skip', () => {
    it('hasVerificationEvidence undefined → skip；false → fail；true → pass', async () => {
      const law = IRON_LAWS['no_completion_without_verification'];

      const skipped = await checker.check(law, { operation: 'code_implementation' });
      expect(skipped.skipped).toBe(true);
      expect(skipped.satisfied).toBe(true);

      const failed = await checker.check(law, {
        operation: 'code_implementation',
        hasVerificationEvidence: false,
      });
      expect(failed.skipped).toBeUndefined();
      expect(failed.satisfied).toBe(false);

      const passed = await checker.check(law, {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      });
      expect(passed.skipped).toBeUndefined();
      expect(passed.satisfied).toBe(true);
    });

    it('hasSingleTask / hasRequirement undefined → skip', async () => {
      const single = await checker.check(IRON_LAWS['incremental_progress'], {
        operation: 'code_implementation',
      });
      expect(single.skipped).toBe(true);

      const req = await checker.check(IRON_LAWS['no_implementation_without_requirement'], {
        operation: 'code_implementation',
      });
      expect(req.skipped).toBe(true);
    });

    it('Iron Law skip 不阻断 checkConstraints', async () => {
      // 三个 flag 全部未接线（CLI pre-commit 路径的典型形态）
      const result = await checker.checkConstraints({
        operation: 'code_implementation',
        projectPath: path.join(tempDir, 'empty'),
      });

      expect(result.passed).toBe(true);
      const skippedIds = result.ironLaws.filter(r => r.skipped).map(r => r.id);
      expect(skippedIds).toEqual(
        expect.arrayContaining([
          'no_completion_without_verification',
          'incremental_progress',
          'no_implementation_without_requirement',
        ])
      );
    });

    it('显式 false 仍按 fail 阻断（skip 语义不改变 fail-closed）', async () => {
      await expect(
        checker.checkConstraints({
          operation: 'code_implementation',
          hasVerificationEvidence: false,
          hasSingleTask: true,
          hasRequirement: true,
        })
      ).rejects.toThrow();
    });
  });

  describe('detectTrigger 补 code_implementation 推断', () => {
    const triggerDir = path.join(tempDir, 'trigger-probe');

    beforeAll(() => {
      // src/ 下有已提交 .ts 文件 → detectSourceRoots 命中 'src'
      fs.mkdirSync(path.join(triggerDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(triggerDir, 'src', 'existing.ts'), 'export const x = 1;');
      execSync('git init', { cwd: triggerDir });
      execSync('git config user.email "test@test.com"', { cwd: triggerDir });
      execSync('git config user.name "Test"', { cwd: triggerDir });
      execSync('git add .', { cwd: triggerDir });
      execSync('git commit -m "init"', { cwd: triggerDir });
    });

    it('源码根内代码变更 → [module_modification, code_implementation]', () => {
      const result = detectTrigger(['src/existing.ts'], { projectPath: triggerDir });
      expect(result).toEqual(['module_modification', 'code_implementation']);
    });

    it('纯文档/配置变更 → 仅 file_modification，不附加 code_implementation', () => {
      const result = detectTrigger(['README.md', 'docs/design.md', '.harness/config.yml'], {
        projectPath: triggerDir,
      });
      expect(result).toBe('file_modification');
    });

    it('源码根外的代码文件 → file_modification + code_implementation', () => {
      const result = detectTrigger(['scripts/build.js'], { projectPath: triggerDir });
      expect(result).toEqual(['file_modification', 'code_implementation']);
    });

    it('仅测试变更 → test_creation + code_implementation', () => {
      const result = detectTrigger(['src/__tests__/existing.test.ts'], { projectPath: triggerDir });
      expect(result).toEqual(['test_creation', 'code_implementation']);
    });

    it('显式 trigger 优先，不做推断', () => {
      const result = detectTrigger(['src/existing.ts'], {
        trigger: 'design_request',
        projectPath: triggerDir,
      });
      expect(result).toBe('design_request');
    });

    it('buildConstraintContext：代码变更 → operation 主推断 + extraTriggers 携带 code_implementation', async () => {
      execSync('git add src/existing.ts', { cwd: triggerDir });
      fs.writeFileSync(path.join(triggerDir, 'src', 'existing.ts'), 'export const x = 2;');
      execSync('git add src/existing.ts', { cwd: triggerDir });

      const ctx = await buildConstraintContext({ projectPath: triggerDir, staged: true });

      expect(ctx.operation).toBe('module_modification');
      expect(ctx.extraTriggers).toEqual(['code_implementation']);
    });
  });

  describe('trace 的 skip 形态', () => {
    it('recordTrace：skip 记录为 result: skip', async () => {
      const records: ExecutionTrace[] = [];
      checker.setTraceRecorder({ record: (t) => records.push(t) });

      await checker.checkConstraints({
        operation: 'code_implementation',
        projectPath: path.join(tempDir, 'empty'),
      });

      const skipTraces = records.filter(t => t.result === 'skip');
      expect(skipTraces.map(t => t.constraintId)).toEqual(
        expect.arrayContaining(['incremental_progress', 'no_implementation_without_requirement'])
      );
    });

    it('TraceAnalyzer：skip 单独计数，不计入 pass/fail 率分母', () => {
      const analyzer = new TraceAnalyzer(null as any);
      const traces: ExecutionTrace[] = [
        { constraintId: 'c1', level: 'iron_law', timestamp: 1, result: 'pass' },
        { constraintId: 'c1', level: 'iron_law', timestamp: 2, result: 'skip' },
        { constraintId: 'c1', level: 'iron_law', timestamp: 3, result: 'skip' },
        { constraintId: 'c1', level: 'iron_law', timestamp: 4, result: 'fail' },
      ];

      const [summary] = analyzer.summarize(traces);
      expect(summary.totalChecks).toBe(4);
      expect(summary.skipCount).toBe(2);
      // 分母 = 4 - 2 = 2（仅实际评估次数）
      expect(summary.passRate).toBe(0.5);
      expect(summary.failRate).toBe(0.5);
    });
  });
});
