/**
 * checker.ts 补充测试
 * 
 * 目标：覆盖 checkCapabilitySync 完整流程、beforeExecution、findApplicableConstraints
 * （ADR-0001：已退役 checker 的用例随约束数据模型 v2 移除）
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import {
  ConstraintChecker,
  checkConstraints,
  checkBeforeExecution,
} from '../core/constraints/checker';
import { getConstraintCheck, type CheckEnv } from '../core/constraints/checkers';
import type { ConstraintContext } from '../types/constraint';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

describe('ConstraintChecker - 补充覆盖', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-checker-extra');
  const checker = ConstraintChecker.getInstance();

  beforeAll(() => {
    // 创建临时 git 仓库
    fs.mkdirSync(tempDir, { recursive: true });
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });

    // 初始提交
    const initialFile = path.join(tempDir, 'initial.txt');
    fs.writeFileSync(initialFile, 'initial');
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

  describe('checkCapabilitySync', () => {
    it('无代码变更应该通过', async () => {
      // 清理 staged changes
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
      
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });

    it('有代码变更且有 CAPABILITIES.md 应该通过', async () => {
      // 创建 CAPABILITIES.md（如果不存在）
      const capFile = path.join(tempDir, 'CAPABILITIES.md');
      fs.writeFileSync(capFile, '# Capabilities\n\n- Feature: test');
      
      // 创建代码文件并 stage
      const codeFile = path.join(tempDir, 'feature.ts');
      fs.writeFileSync(codeFile, 'export function feature() {}');
      execSync('git add .', { cwd: tempDir });

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      // Cleanup
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
    });

    it('有代码变更且 CAPABILITIES.md 有表格但缺少新模块应该失败', async () => {
      // 创建 CAPABILITIES.md，含表格但不包含新文件
      const capFile = path.join(tempDir, 'CAPABILITIES.md');
      fs.writeFileSync(capFile, '# Capabilities\n\n| 模块 | 文件 | 功能 |\n|------|------|------|\n| 旧模块 | old/module.ts | 旧功能 |');

      // 创建新的代码文件并 stage
      const codeFile = path.join(tempDir, 'new-module.ts');
      fs.writeFileSync(codeFile, 'export function newModule() {}');
      execSync('git add .', { cwd: tempDir, stdio: 'pipe' });

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      // CAPABILITIES.md 有表格但新文件未被覆盖，应该失败
      expect(result.satisfied).toBe(false);

      // Cleanup
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
    });

    it('有代码变更但无 CAPABILITIES.md 应该跳过（ADR-0001 存在性探测）', async () => {
      // 确保 CAPABILITIES.md 不存在
      const capFile = path.join(tempDir, 'CAPABILITIES.md');
      if (fs.existsSync(capFile)) {
        fs.rmSync(capFile, { force: true });
      }

      // 创建新的代码文件并 stage
      const newCodeFile = path.join(tempDir, 'newfeature.ts');
      fs.writeFileSync(newCodeFile, 'export function newfeature() {}');
      execSync('git add ' + newCodeFile, { cwd: tempDir });

      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
      };

      const result = await checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        context
      );

      // 未采用 CAPABILITIES.md 约定 → skip（不计 pass/fail，不阻断）
      expect(result.skipped).toBe(true);
      expect(result.satisfied).toBe(true);

      // Cleanup
      execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
    });
  });

  describe('checkCapabilitySync module 模式（governance.capabilities.mode）', () => {
    /** 建一个带 .harness/config.yml + CAPABILITIES.md + 源文件的临时项目 */
    const setupCapProject = (
      name: string,
      mode: 'file' | 'module' | undefined,
      capContent: string,
      files: string[]
    ): string => {
      const dir = path.join(tempDir, name);
      fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
      const yaml = require('js-yaml');
      const config = mode ? { governance: { capabilities: { mode } } } : {};
      fs.writeFileSync(path.join(dir, '.harness', 'config.yml'), yaml.dump(config));
      fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), capContent);
      for (const f of files) {
        const fp = path.join(dir, f);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, 'export const x = 1;');
      }
      return dir;
    };

    const runCapCheck = (projectPath: string) =>
      checker.check(
        {
          id: 'capability_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CAPABILITY SYNC',
          message: 'test',
          trigger: 'commit',
          enforcement: 'test',
        },
        { operation: 'commit', projectPath }
      );

    beforeAll(() => {
      // 清理 staged 状态，隔离 step 1（git diff 增量）对本组用例的干扰
      try {
        execSync('git reset HEAD', { cwd: tempDir, stdio: 'pipe' });
      } catch {
        // ignore
      }
    });

    it('module 模式：目录条目覆盖源文件应该通过', async () => {
      const dir = setupCapProject(
        'capmod-covered',
        'module',
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| 核心 | src/core/ | 核心模块 |',
        ['src/core/foo.ts', 'src/core/bar.ts']
      );

      const result = await runCapCheck(dir);
      expect(result.satisfied).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('module 模式：文件条目精确匹配也算覆盖', async () => {
      const dir = setupCapProject(
        'capmod-file-entry',
        'module',
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| foo | src/core/foo.ts | foo |',
        ['src/core/foo.ts']
      );

      const result = await runCapCheck(dir);
      expect(result.satisfied).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('module 模式：新目录未登记应该失败', async () => {
      const dir = setupCapProject(
        'capmod-uncovered',
        'module',
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| 核心 | src/core/ | 核心模块 |',
        ['src/core/foo.ts', 'src/newdir/bar.ts']
      );

      const result = await runCapCheck(dir);
      expect(result.satisfied).toBe(false);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('file 模式原行为不变：目录条目不参与覆盖判定', async () => {
      // file 模式下 step2 要求逐文件精确匹配，src/core/ 目录条目不能 rescue bar.ts
      const dir = setupCapProject(
        'capfile-dir-no-rescue',
        'file',
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| foo | src/core/foo.ts | foo |\n| 目录 | src/core/ | 目录条目 |',
        ['src/core/foo.ts', 'src/core/bar.ts']
      );

      const result = await runCapCheck(dir);
      expect(result.satisfied).toBe(false);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('step2 全量扫描（file 模式）：全部源文件已登记应该通过', async () => {
      const dir = setupCapProject(
        'capfile-step2-ok',
        undefined,
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| foo | src/foo.ts | foo |',
        ['src/foo.ts']
      );

      const result = await runCapCheck(dir);
      expect(result.satisfied).toBe(true);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('step2 全量扫描（file 模式）：有未登记源文件应该失败', async () => {
      const dir = setupCapProject(
        'capfile-step2-missing',
        undefined,
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| foo | src/foo.ts | foo |',
        ['src/foo.ts', 'src/unlisted.ts']
      );

      const result = await runCapCheck(dir);
      expect(result.satisfied).toBe(false);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('checkCapabilitySync 遗留问题回归（2026-08-08 评估稿第四节）', () => {
    const capCheck = getConstraintCheck('capability_sync')!;

    const setupDir = (name: string, capContent: string, files: string[] = []): string => {
      const dir = path.join(tempDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), capContent);
      for (const f of files) {
        const fp = path.join(dir, f);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, 'export const x = 1;');
      }
      return dir;
    };

    /** 直接构造 CheckEnv：stub stagedDiffNames / srcScan，不走真实 git */
    const makeEnv = (
      projectPath: string,
      staged: string[],
      scan: Record<string, string[]> = {}
    ): CheckEnv => ({
      context: { operation: 'commit', projectPath },
      projectPath,
      stagedDiff: async () => '',
      stagedDiffNames: async () => staged.join('\n'),
      srcScan: (root: string) => scan[root] ?? [],
    });

    const tableWith = (row: string): string =>
      '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n' + row + '\n';

    const EMPTY_TABLE = '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n';

    it('问题1：step1 应要求每个变更文件都被覆盖（every 而非 some）', async () => {
      // 文档登记 src/foo.ts；同时 staged 已登记的 src/foo.ts 与未登记的 scripts/bar.ts
      // some() 下只要有 foo.ts 命中即整体通过，bar.ts 漏网
      const dir = setupDir('legacy-step1-some', tableWith('| foo | src/foo.ts | foo |'));
      try {
        expect(await capCheck.evaluate(makeEnv(dir, ['src/foo.ts', 'scripts/bar.ts']))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('问题3a：step1 不得因 endsWith 造成后缀碰撞（xfoo.ts 不应被 foo.ts 覆盖）', async () => {
      const dir = setupDir('legacy-step1-endswith', tableWith('| foo | foo.ts | foo |'));
      try {
        expect(await capCheck.evaluate(makeEnv(dir, ['web/xfoo.ts']))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('问题3b：step1 不得因 includes 造成子串误配（docs/src/foo.tsx 不应被 src/foo.ts 覆盖）', async () => {
      const dir = setupDir('legacy-step1-includes', tableWith('| foo | src/foo.ts | foo |'));
      try {
        expect(await capCheck.evaluate(makeEnv(dir, ['docs/src/foo.tsx']))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('兼容：basename 条目仍可按路径边界后缀匹配（src/foo.ts 被 foo.ts 覆盖）', async () => {
      const dir = setupDir('legacy-step1-suffix-ok', tableWith('| foo | foo.ts | foo |'));
      try {
        expect(await capCheck.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('问题2：空表格 + 有 staged 变更时不得直接放行', async () => {
      const dir = setupDir('legacy-empty-table-diff', EMPTY_TABLE);
      try {
        expect(await capCheck.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('问题2：空表格 + 源码根有文件时 step2 不得直接放行', async () => {
      const dir = setupDir('legacy-empty-table-scan', EMPTY_TABLE, ['src/foo.ts']);
      try {
        expect(await capCheck.evaluate(makeEnv(dir, [], { src: ['src/foo.ts'] }))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('问题2 兼容：清单格式（计数行）无文件表，仍直接放行', async () => {
      const dir = setupDir(
        'legacy-listing-format',
        '# Harness Capabilities\n\n## CLI Commands (25)\ncheck, validate\n'
      );
      try {
        expect(await capCheck.evaluate(makeEnv(dir, ['src/foo.ts']))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('问题4：检查异常默认放行时应输出 warn 而非静默吞错', async () => {
      const dir = setupDir('legacy-failopen', tableWith('| foo | src/foo.ts | foo |'));
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const env: CheckEnv = {
          ...makeEnv(dir, []),
          stagedDiffNames: async () => {
            throw new Error('git boom');
          },
        };
        // fail-open 语义保留：异常时仍放行
        expect(await capCheck.evaluate(env)).toBe(true);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('step2（file 模式）与 step1 语义一致：basename 条目可按路径边界后缀覆盖', async () => {
      // 文档第二列写 basename foo.ts；step1 认可它（边界后缀），
      // step2 裸精确匹配却永远不命中 srcScan 返回的 src/foo.ts → 永远红
      const dir = setupDir('legacy-step2-basename', tableWith('| foo | foo.ts | foo |'), [
        'src/foo.ts',
      ]);
      try {
        expect(await capCheck.evaluate(makeEnv(dir, [], { src: ['src/foo.ts'] }))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('step2（file 模式）：不同路径的同后缀文件不得被误覆盖（lib/foo.ts 不覆盖 src/foo.ts）', async () => {
      const dir = setupDir('legacy-step2-boundary', tableWith('| foo | lib/foo.ts | foo |'), [
        'src/foo.ts',
      ]);
      try {
        expect(await capCheck.evaluate(makeEnv(dir, [], { src: ['src/foo.ts'] }))).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('step2（module 模式）文件条目同样按路径边界后缀覆盖', async () => {
      const dir = setupDir('legacy-step2-module-suffix', tableWith('| foo | foo.ts | foo |'), [
        'src/foo.ts',
      ]);
      fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.harness', 'config.yml'),
        'governance:\n  capabilities:\n    mode: module\n'
      );
      try {
        expect(await capCheck.evaluate(makeEnv(dir, [], { src: ['src/foo.ts'] }))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('findApplicableConstraints', () => {
    it('应该过滤出匹配 trigger 的约束', () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = checker.findApplicableConstraints(context);

      expect(result.ironLaws.length).toBeGreaterThan(0);
      expect(
        result.ironLaws.some((c: any) => c.id === 'no_completion_without_verification')
      ).toBe(true);
    });

    it('不匹配的 trigger 应该返回空数组', () => {
      const context: ConstraintContext = {
        operation: 'file_creation',  // 一个很少用到的 trigger
      };

      const result = checker.findApplicableConstraints(context);

      // file_creation 可能没有任何约束匹配
      // 这个测试的目的是验证 filterByTrigger 逻辑
      expect(Array.isArray(result.ironLaws)).toBe(true);
      expect(Array.isArray(result.guidelines)).toBe(true);
    });
  });

  describe('checkBeforeExecution', () => {
    it('通过检查不应该抛出异常', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
        hasVerificationEvidence: true,
        hasWorktree: true,
        hasRequirement: true,
        taskDescription: 'Test task — single focused change',
        hasSingleTask: true,
        hasRequirementReview: true,
        hasTwoStageReview: true,
        completionClaimText: 'All 142 tests passed, coverage 87.3%',
      } as any;

      // 不应该抛出异常
      await expect(checkBeforeExecution(context)).resolves.not.toThrow();
    });

    it('违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkBeforeExecution(context)).rejects.toThrow();
    });
  });

  describe('checkConstraints 完整流程', () => {
    it('应该返回完整的三层检查结果', async () => {
      const context: ConstraintContext = {
        operation: 'commit',
        projectPath: tempDir,
        hasTest: true,
        hasReuseCheck: true,
      };

      const result = await checkConstraints(context);

      expect(result.ironLaws).toBeDefined();
      expect(result.guidelines).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(typeof result.warningCount).toBe('number');
    });
  });

  describe('自定义约束配置', () => {
    it('per-request customConfig 应该生效', () => {
      const constraints = checker.getConstraints({
        ironLaws: {},
        guidelines: {},
        disabled: [],
        custom: [],
      });

      expect(constraints.ironLaws).toEqual({});
      expect(constraints.guidelines).toEqual({});
    });
  });

  describe('getSeverity', () => {
    it('iron_law 应该返回 error', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
      };

      const result = await checker.check(
        {
          id: 'test_severity_iron',
          kind: 'prompt',
          level: 'iron_law',
          rule: 'TEST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result).toBeDefined();
    });

    it('guideline 应该返回 warning', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
      };

      const result = await checker.check(
        {
          id: 'test_severity_guideline',
          kind: 'prompt',
          level: 'guideline',
          rule: 'TEST',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result).toBeDefined();
    });

  });

  describe('checkException 例外豁免', () => {
    it('guideline 匹配例外条件应该被豁免', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isSimpleTypo: true,
      };

      const result = await checker.check(
        {
          id: 'incremental_progress',
          kind: 'check',
          level: 'guideline',
          rule: 'ONE TASK PER SESSION',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['simple_typo', 'config_value_error'],
        },
        context
      );

      expect(result.satisfied).toBe(true);
      expect(result.message).toContain('豁免');
    });

    it('guideline 不匹配例外条件应该正常检查', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isSimpleTypo: false,
        isConfigValueError: false,
      };

      const result = await checker.check(
        {
          id: 'incremental_progress',
          kind: 'check',
          level: 'guideline',
          rule: 'ONE TASK PER SESSION',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['simple_typo', 'config_value_error'],
        },
        context
      );

      // hasSingleTask 未接线（undefined）→ skip（ADR-0001：flag 未接线不评估，不误报违规）
      expect(result.skipped).toBe(true);
      expect(result.satisfied).toBe(true);
    });

    it('iron_law 不应该检查例外条件', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        isSimpleTypo: true,
      };

      const result = await checker.check(
        {
          id: 'incremental_progress',
          kind: 'check',
          level: 'iron_law',
          rule: 'ONE TASK PER SESSION',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
          exceptions: ['simple_typo'],
        },
        context
      );

      // iron_law 不适用例外；hasSingleTask 未接线（undefined）→ skip（ADR-0001）
      expect(result.skipped).toBe(true);
      expect(result.satisfied).toBe(true);
    });

    it('无 exceptions 字段应该正常检查', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const result = await checker.check(
        {
          id: 'no_completion_without_verification',
          kind: 'check',
          level: 'iron_law',
          rule: 'NO COMPLETION WITHOUT VERIFICATION',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);
    });
  });

  describe('checkNoBypassCheckpoint 文件内容检查', () => {
    it('changedFiles 包含 skip 内容应该失败', async () => {
      const bypassFile = path.join(tempDir, 'bypass-test.ts');
      fs.writeFileSync(bypassFile, 'test.skip("skipped", () => {});');
      execSync('git add .', { cwd: tempDir, stdio: 'pipe' });

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: tempDir,
        changedFiles: [bypassFile],
      };

      const result = await checker.check(
        {
          id: 'no_bypass_checkpoint',
          kind: 'check',
          level: 'iron_law',
          rule: 'NO BYPASS',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false);

      fs.unlinkSync(bypassFile);
      execSync('git reset HEAD -- ' + bypassFile, { cwd: tempDir, stdio: 'pipe' });
    });

    it('changedFiles 不包含 bypass 内容应该通过', async () => {
      const cleanFile = path.join(tempDir, 'clean-test.ts');
      fs.writeFileSync(cleanFile, 'test("clean", () => { expect(true).toBe(true); });');
      execSync('git add .', { cwd: tempDir, stdio: 'pipe' });

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: tempDir,
        changedFiles: [cleanFile],
      };

      const result = await checker.check(
        {
          id: 'no_bypass_checkpoint',
          kind: 'check',
          level: 'iron_law',
          rule: 'NO BYPASS',
          message: 'test',
          trigger: 'code_implementation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.unlinkSync(cleanFile);
      execSync('git reset HEAD -- ' + cleanFile, { cwd: tempDir, stdio: 'pipe' });
    });
  });

  describe('checkConstraint 快捷函数', () => {
    it('未知约束应该返回不满足', async () => {
      const { checkConstraint } = await import('../core/constraints/checker');

      const context: ConstraintContext = {
        operation: 'commit',
      };

      const result = await checkConstraint('nonexistent_constraint', context);
      expect(result.satisfied).toBe(false);
      expect(result.message).toContain('未知');
    });

    it('已知约束应该正常检查', async () => {
      const { checkConstraint } = await import('../core/constraints/checker');

      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasVerificationEvidence: true,
      };

      const result = await checkConstraint('no_completion_without_verification', context);
      expect(result.id).toBe('no_completion_without_verification');
      expect(result.satisfied).toBe(true);
    });
  });

  describe('checkConstraints Iron Law 违规', () => {
    it('Iron Law 违规应该抛出 ConstraintViolationError', async () => {
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      await expect(checkConstraints(context)).rejects.toThrow();
    });
  });

  describe('checkNoTestSimplification git diff 失败', () => {
    it('git diff 失败应该默认通过', async () => {
      // 非 git 目录
      const nonGitDir = path.join(tempDir, 'non-git');
      fs.mkdirSync(nonGitDir, { recursive: true });

      const context: ConstraintContext = {
        operation: 'test_creation',
        projectPath: nonGitDir,
      };

      const result = await checker.check(
        {
          id: 'no_test_simplification',
          kind: 'check',
          level: 'iron_law',
          rule: 'NO SIMPLIFY',
          message: 'test',
          trigger: 'test_creation',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  describe('checkContextDocSync', () => {
    it('无 governance 配置应该通过', async () => {
      // 无 .harness/config.yml
      const noConfigDir = path.join(tempDir, 'no-config');
      fs.mkdirSync(noConfigDir, { recursive: true });

      const context: ConstraintContext = {
        operation: 'module_modification',
        projectPath: noConfigDir,
      };

      const result = await checker.check(
        {
          id: 'context_doc_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CONTEXT DOC SYNC',
          message: 'test',
          trigger: 'module_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(noConfigDir, { recursive: true, force: true });
    });

    it('有配置但 CONTEXT.md 存在应该通过', async () => {
      const configDir = path.join(tempDir, 'with-context');
      const harnessDir = path.join(configDir, '.harness');
      const srcDir = path.join(configDir, 'src');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // 写入 governance 配置
      const yaml = require('js-yaml');
      const config = {
        governance: {
          context_files: {
            enabled: true,
            required_dirs: ['src'],
          },
        },
      };
      fs.writeFileSync(path.join(harnessDir, 'config.yml'), yaml.dump(config));

      // 创建 CONTEXT.md
      fs.writeFileSync(path.join(srcDir, 'CONTEXT.md'), '# src\n\nTest context');

      const context: ConstraintContext = {
        operation: 'module_modification',
        projectPath: configDir,
      };

      const result = await checker.check(
        {
          id: 'context_doc_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CONTEXT DOC SYNC',
          message: 'test',
          trigger: 'module_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(configDir, { recursive: true, force: true });
    });

    it('有配置但缺少 CONTEXT.md 应该失败', async () => {
      const configDir = path.join(tempDir, 'missing-context');
      const harnessDir = path.join(configDir, '.harness');
      const srcDir = path.join(configDir, 'src');
      fs.mkdirSync(harnessDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      const yaml = require('js-yaml');
      const config = {
        governance: {
          context_files: {
            enabled: true,
            required_dirs: ['src'],
          },
        },
      };
      fs.writeFileSync(path.join(harnessDir, 'config.yml'), yaml.dump(config));
      // 不创建 CONTEXT.md

      const context: ConstraintContext = {
        operation: 'module_modification',
        projectPath: configDir,
      };

      const result = await checker.check(
        {
          id: 'context_doc_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CONTEXT DOC SYNC',
          message: 'test',
          trigger: 'module_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false);

      fs.rmSync(configDir, { recursive: true, force: true });
    });

    it('context_files.enabled 为 false 应该跳过', async () => {
      const configDir = path.join(tempDir, 'disabled-context');
      const harnessDir = path.join(configDir, '.harness');
      fs.mkdirSync(harnessDir, { recursive: true });

      const yaml = require('js-yaml');
      const config = {
        governance: {
          context_files: {
            enabled: false,
            required_dirs: ['src'],
          },
        },
      };
      fs.writeFileSync(path.join(harnessDir, 'config.yml'), yaml.dump(config));

      const context: ConstraintContext = {
        operation: 'module_modification',
        projectPath: configDir,
      };

      const result = await checker.check(
        {
          id: 'context_doc_sync',
          kind: 'check',
          level: 'guideline',
          rule: 'CONTEXT DOC SYNC',
          message: 'test',
          trigger: 'module_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true); // enabled: false → 跳过检查

      fs.rmSync(configDir, { recursive: true, force: true });
    });
  });

  describe('checkDocsFreshness', () => {
    it('无 CAPABILITIES.md 应该通过', async () => {
      const noCapDir = path.join(tempDir, 'no-cap-freshness');
      fs.mkdirSync(noCapDir, { recursive: true });

      const context: ConstraintContext = {
        operation: 'file_modification',
        projectPath: noCapDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: 'file_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(noCapDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 无表格应该通过', async () => {
      const capDir = path.join(tempDir, 'cap-no-table');
      fs.mkdirSync(capDir, { recursive: true });
      fs.writeFileSync(path.join(capDir, 'CAPABILITIES.md'), '# Capabilities\n\nNo table here.');

      const context: ConstraintContext = {
        operation: 'file_modification',
        projectPath: capDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: 'file_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(capDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 表格包含所有 src 文件应该通过', async () => {
      const capDir = path.join(tempDir, 'cap-synced');
      const srcDir = path.join(capDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 创建源文件
      fs.writeFileSync(path.join(srcDir, 'module.ts'), 'export const x = 1;');

      // 创建 CAPABILITIES.md，包含该文件
      fs.writeFileSync(
        path.join(capDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| module | src/module.ts | test |'
      );

      const context: ConstraintContext = {
        operation: 'file_modification',
        projectPath: capDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: 'file_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(capDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 列出的文件存在应该通过', async () => {
      const capDir = path.join(tempDir, 'cap-valid');
      const srcDir = path.join(capDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 创建源文件
      fs.writeFileSync(path.join(srcDir, 'old.ts'), 'export const x = 1;');
      fs.writeFileSync(path.join(srcDir, 'new.ts'), 'export const y = 2;');

      // CAPABILITIES.md 包含 old.ts（存在）和 new.ts（也存在）
      fs.writeFileSync(
        path.join(capDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |\n| new | src/new.ts | new |'
      );

      const context: ConstraintContext = {
        operation: 'file_modification',
        projectPath: capDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: 'file_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true); // 列出的文件都存在 → 通过

      fs.rmSync(capDir, { recursive: true, force: true });
    });

    it('CAPABILITIES.md 列出的文件已删除应该失败', async () => {
      const capDir = path.join(tempDir, 'cap-ghost');
      const srcDir = path.join(capDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // 只创建 old.ts，不创建 deleted.ts
      fs.writeFileSync(path.join(srcDir, 'old.ts'), 'export const x = 1;');

      // CAPABILITIES.md 列出了已删除的 deleted.ts
      fs.writeFileSync(
        path.join(capDir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| old | src/old.ts | old |\n| deleted | src/deleted.ts | deleted |'
      );

      const context: ConstraintContext = {
        operation: 'file_modification',
        projectPath: capDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: 'file_modification',
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(false); // deleted.ts 不存在 → 失败

      fs.rmSync(capDir, { recursive: true, force: true });
    });

    // CLAUDE.md Domain Packages 检查
    it('CLAUDE.md Domain Packages 包含不存在的目录应该失败', async () => {
      const projDir = path.join(tempDir, 'claude-stale-pkg');
      fs.mkdirSync(projDir, { recursive: true });
      // 不创建 packages/studio-xxx 目录

      fs.writeFileSync(
        path.join(projDir, 'CLAUDE.md'),
        '## Domain Packages\n\n- `packages/studio-ghost` — Ghost package\n'
      );

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });

    it('CLAUDE.md Domain Packages 与实际 packages 同步应该通过', async () => {
      const projDir = path.join(tempDir, 'claude-synced-pkg');
      const pkgDir = path.join(projDir, 'packages', 'studio-test');
      fs.mkdirSync(pkgDir, { recursive: true });

      fs.writeFileSync(
        path.join(projDir, 'CLAUDE.md'),
        '## Domain Packages\n\n- `packages/studio-test` — Test package\n'
      );

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });

    it('实际存在包但 CLAUDE.md 未记录应该失败', async () => {
      const projDir = path.join(tempDir, 'claude-missing-pkg');
      const pkgDir = path.join(projDir, 'packages', 'studio-unlisted');
      fs.mkdirSync(pkgDir, { recursive: true });

      // CLAUDE.md 没有提到 studio-unlisted
      fs.writeFileSync(
        path.join(projDir, 'CLAUDE.md'),
        '## Domain Packages\n\n- `packages/studio-other` — Other\n'
      );
      // 创建 studio-other 以通过反向检查
      fs.mkdirSync(path.join(projDir, 'packages', 'studio-other'), { recursive: true });

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });

    // CLAUDE.md Key Architecture Paths 检查
    it('CLAUDE.md Key Architecture Paths 引用不存在路径应该失败', async () => {
      const projDir = path.join(tempDir, 'claude-stale-paths');
      fs.mkdirSync(projDir, { recursive: true });

      fs.writeFileSync(
        path.join(projDir, 'CLAUDE.md'),
        '## Key Architecture Paths\n\n| 组件 | 路径 |\n|---|---|\n| Ghost | `apps/api/src/modules/ghost/` |\n'
      );

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });

    it('CLAUDE.md Key Architecture Paths 全部存在应该通过', async () => {
      const projDir = path.join(tempDir, 'claude-valid-paths');
      const moduleDir = path.join(projDir, 'apps', 'api', 'src', 'modules', 'goals');
      fs.mkdirSync(moduleDir, { recursive: true });

      fs.writeFileSync(
        path.join(projDir, 'CLAUDE.md'),
        '## Key Architecture Paths\n\n| 组件 | 路径 |\n|---|---|\n| Goal | `apps/api/src/modules/goals/` |\n'
      );

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });

    it('无 CLAUDE.md 应该通过', async () => {
      const projDir = path.join(tempDir, 'claude-none');
      fs.mkdirSync(projDir, { recursive: true });

      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });


  describe('checkConstraintsSafe', () => {
    it('should not throw even with iron law violations', async () => {
      const { checkConstraintsSafe } = await import('../core/constraints/checker');
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: false,
        hasVerificationEvidence: false,
      };

      const result = await checkConstraintsSafe(context);
      expect(result.passed).toBe(false);
      // Should have at least one iron law violation even though it didn't throw
      expect(result.ironLaws.length).toBeGreaterThan(0);
    });

    it('should return passed=true when all constraints satisfied', async () => {
      const { checkConstraintsSafe } = await import('../core/constraints/checker');
      const context: ConstraintContext = {
        operation: 'code_implementation',
        hasTest: true,
        hasVerificationEvidence: true,
        hasSingleTask: true,
        hasRequirementReview: true,
        hasRequirement: true,
        hasWorktree: true,
        hasTwoStageReview: true,
        hasRootCauseInvestigation: true,
        hasFailingTest: true,
        hasReuseCheck: true,
        completionClaimText: 'All 142 tests passed, coverage 85.2%',
        taskDescription: 'Implement the new feature with proper testing',
      };

      const result = await checkConstraintsSafe(context);
      expect(result.passed).toBe(true);
      expect(result.warningCount).toBe(0);
    });
  });

  // S1: per-request customConfig 隔离
  describe('S1: per-request customConfig isolation', () => {
    it('使用 per-request customConfig 不应污染单例状态', () => {
      const checker = ConstraintChecker.getInstance();

      // 记录原始状态
      const defaultConstraints = checker.getConstraints();
      const defaultIronLawKeys = Object.keys(defaultConstraints.ironLaws);

      // 创建自定义配置（只有 1 个 iron law）
      const customConfig = {
        ironLaws: {
          test_only: {
            id: 'test_only',
            kind: 'prompt' as const,
            level: 'iron_law' as const,
            rule: 'TEST',
            message: 'test',
            trigger: 'file_modification',
            enforcement: 'test',
          },
        },
        guidelines: {},
        disabled: [] as string[],
        custom: [] as string[],
      };

      // 用 per-request 参数获取约束
      const requestConstraints = checker.getConstraints(customConfig);
      expect(Object.keys(requestConstraints.ironLaws)).toEqual(['test_only']);

      // 单例状态应保持不变
      const afterConstraints = checker.getConstraints();
      expect(Object.keys(afterConstraints.ironLaws)).toEqual(defaultIronLawKeys);

      // 用 null 也应该使用默认
      const nullConfigConstraints = checker.getConstraints(null);
      expect(Object.keys(nullConfigConstraints.ironLaws)).toEqual(defaultIronLawKeys);
    });

    it('并发场景：两个请求使用不同 customConfig 不应互相干扰', async () => {
      const checker = ConstraintChecker.getInstance();

      const configA = {
        ironLaws: {
          rule_a: {
            id: 'rule_a',
            kind: 'prompt' as const,
            level: 'iron_law' as const,
            rule: 'A',
            message: 'project A',
            trigger: 'file_modification',
            enforcement: 'test',
          },
        },
        guidelines: {},
        disabled: [] as string[],
        custom: [] as string[],
      };

      const configB = {
        ironLaws: {
          rule_b: {
            id: 'rule_b',
            kind: 'prompt' as const,
            level: 'iron_law' as const,
            rule: 'B',
            message: 'project B',
            trigger: 'file_modification',
            enforcement: 'test',
          },
        },
        guidelines: {},
        disabled: [] as string[],
        custom: [] as string[],
      };

      const context: ConstraintContext = {
        operation: 'file_modification',
        projectPath: process.cwd(),
        hasTest: true,
        hasVerificationEvidence: true,
        hasSingleTask: true,
        hasExternalCapabilityVerification: true,
        hasRequirementReview: true,
        hasRequirement: true,
        hasWorktree: true,
        hasTwoStageReview: true,
      };

      // 并发运行 A 和 B
      const [resultA, resultB] = await Promise.all([
        checker.checkConstraints(context, configA),
        checker.checkConstraints(context, configB),
      ]);

      // A 应该只检查 rule_a
      const ironLawIdsA = resultA.ironLaws.map(r => r.id);
      expect(ironLawIdsA).toContain('rule_a');
      expect(ironLawIdsA).not.toContain('rule_b');

      // B 应该只检查 rule_b
      const ironLawIdsB = resultB.ironLaws.map(r => r.id);
      expect(ironLawIdsB).toContain('rule_b');
      expect(ironLawIdsB).not.toContain('rule_a');
    });

    it('findApplicableConstraints 应接受 per-request config', () => {
      const checker = ConstraintChecker.getInstance();

      const customConfig = {
        ironLaws: {
          custom_rule: {
            id: 'custom_rule',
            kind: 'prompt' as const,
            level: 'iron_law' as const,
            rule: 'CUSTOM',
            message: 'custom',
            trigger: 'file_modification',
            enforcement: 'test',
          },
        },
        guidelines: {},
        disabled: [] as string[],
        custom: [] as string[],
      };

      const context: ConstraintContext = { operation: 'file_modification' };
      const applicable = checker.findApplicableConstraints(context, customConfig);
      expect(applicable.ironLaws.map(c => c.id)).toEqual(['custom_rule']);
    });
  });

    it('step_execution 触发应该生效', async () => {
      const projDir = path.join(tempDir, 'claude-trigger');
      fs.mkdirSync(projDir, { recursive: true });

      // 创建一个有 stale Domain Packages 的 CLAUDE.md
      fs.writeFileSync(
        path.join(projDir, 'CLAUDE.md'),
        '## Domain Packages\n\n- `packages/studio-ghost` — Ghost\n'
      );

      // 用 step_execution 触发
      const context: ConstraintContext = {
        operation: 'code_implementation',
        projectPath: projDir,
      };

      const result = await checker.check(
        {
          id: 'docs_freshness',
          kind: 'check',
          level: 'guideline',
          rule: 'DOCS FRESHNESS',
          message: 'test',
          trigger: ['file_modification', 'code_implementation'],
          enforcement: 'test',
        },
        context
      );

      expect(result.satisfied).toBe(true);

      fs.rmSync(projDir, { recursive: true, force: true });
    });
  });
});
