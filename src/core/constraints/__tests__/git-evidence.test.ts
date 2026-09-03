/**
 * git 证据适配器测试（架构评审 #87）
 *
 * 覆盖：
 * - 真 git adapter 在三类证据（staged diff / 变更名 / HEAD 目录）上的取证正确性
 * - 命令失败语义：diff → ''、ls-tree → null（全部视为新目录）
 * - memo 落在实例层：同一实例内每条 git 命令至多执行一次
 * - context-builder 与 checker 共用同一实例 → 一次 run 内无重复 git 命令
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

import {
  createGitEvidence,
  parseHeadDirs,
  realGitCommandRunner,
  type GitCommandRunner,
  type GitEvidence,
} from '../git-evidence';
import { buildConstraintContext } from '../context-builder';
import { ConstraintChecker } from '../checker';
import { GUIDELINES } from '../definitions';
import type { MergedConstraintsConfig } from '../../../types/project-config';

/** 建一个真 git fixture：committed src/existing.ts + 一个 staged 修改 */
function makeRepo(options: { stagedChange?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-evidence-'));
  execSync('git init -q', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'existing.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'src', 'nested', 'deep.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -q -m init', { cwd: dir, stdio: 'pipe' });
  if (options.stagedChange !== false) {
    fs.writeFileSync(path.join(dir, 'src', 'existing.ts'), 'export const a = 2;\n');
    execSync('git add src/existing.ts', { cwd: dir, stdio: 'pipe' });
  }
  return dir;
}

/** 记录每条实际执行的 git 命令，执行本身委托真 adapter */
function countingRunner(): { runner: GitCommandRunner; commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    runner: (command, cwd) => {
      commands.push(command);
      return realGitCommandRunner(command, cwd);
    },
  };
}

/** 包住一份证据实例，记录「哪个 phase 调了哪个证据方法」（取证是否同源的可观测面） */
function recordingEvidence(
  source: GitEvidence,
  phase: () => string,
  calls: string[]
): GitEvidence {
  return {
    projectPath: source.projectPath,
    stagedDiff: () => {
      calls.push(`${phase()}:stagedDiff`);
      return source.stagedDiff();
    },
    changedFileNames: (staged: boolean) => {
      calls.push(`${phase()}:changedFileNames`);
      return source.changedFileNames(staged);
    },
    headDirs: () => {
      calls.push(`${phase()}:headDirs`);
      return source.headDirs();
    },
  };
}

describe('git 证据适配器（#87）', () => {
  describe('真 git adapter 取证', () => {
    it('stagedDiff 返回 staged 全量 diff；changedFileNames 按 staged 选择命令', () => {
      const dir = makeRepo();
      const evidence = createGitEvidence(dir);

      expect(evidence.stagedDiff()).toContain('+export const a = 2;');
      expect(evidence.changedFileNames(true)).toBe('src/existing.ts');
      // 无未暂存变更 → unstaged diff 为空
      expect(evidence.changedFileNames(false)).toBe('');

      fs.writeFileSync(path.join(dir, 'src', 'existing.ts'), 'export const a = 3;\n');
      expect(evidence.changedFileNames(false)).toBe(''); // 实例已 memo，取同一快照
      expect(createGitEvidence(dir).changedFileNames(false)).toBe('src/existing.ts');
    });

    it('headDirs 覆盖已提交目录，未提交目录不在集合内', () => {
      const dir = makeRepo();
      const dirs = createGitEvidence(dir).headDirs();

      expect(dirs).not.toBeNull();
      expect(dirs!.has('src')).toBe(true);
      expect(dirs!.has('src/nested')).toBe(true);
      fs.mkdirSync(path.join(dir, 'src', 'brand-new'), { recursive: true });
      expect(createGitEvidence(dir).headDirs()!.has('src/brand-new')).toBe(false);
    });

    it('非 git 目录：diff 类证据为空串，headDirs 为 null（不重试、不抛错）', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-evidence-'));
      const { runner, commands } = countingRunner();
      const evidence = createGitEvidence(dir, runner);

      expect(evidence.stagedDiff()).toBe('');
      expect(evidence.changedFileNames(true)).toBe('');
      expect(evidence.headDirs()).toBeNull();
      // 失败结果同样 memo：重复调用不再 spawn
      expect(evidence.headDirs()).toBeNull();
      expect(evidence.changedFileNames(true)).toBe('');
      expect(commands.length).toBe(3);
    });
  });

  describe('parseHeadDirs', () => {
    it('逐层展开文件路径的父目录', () => {
      const dirs = parseHeadDirs('src/a/b.ts\nREADME.md\n');
      expect([...dirs].sort()).toEqual(['src', 'src/a']);
    });
  });

  describe('memo 落在实例层', () => {
    it('同一实例内同类 git 命令至多执行一次', () => {
      const dir = makeRepo();
      const { runner, commands } = countingRunner();
      const evidence = createGitEvidence(dir, runner);

      const first = evidence.stagedDiff();
      const stagedNames = evidence.changedFileNames(true);
      const unstagedNames = evidence.changedFileNames(false);
      const dirs = evidence.headDirs();

      expect(evidence.stagedDiff()).toBe(first);
      expect(evidence.changedFileNames(true)).toBe(stagedNames);
      expect(evidence.changedFileNames(false)).toBe(unstagedNames);
      expect(evidence.headDirs()).toEqual(dirs);

      expect(commands).toEqual([
        'git diff --cached',
        'git diff --cached --name-only',
        'git diff --name-only',
        'git ls-tree -r --name-only HEAD',
      ]);
      expect(new Set(commands).size).toBe(commands.length);
    });

    it('两个实例 = 两次取证（memo 不是隐式全局）', () => {
      const dir = makeRepo();
      const { runner, commands } = countingRunner();

      createGitEvidence(dir, runner).stagedDiff();
      createGitEvidence(dir, runner).stagedDiff();

      expect(commands.filter(c => c === 'git diff --cached')).toHaveLength(2);
    });
  });

  describe('context-builder 与 checker 共用同一证据来源（#87 验收）', () => {
    it('一次 check run 内同类 git 命令至多执行一次', async () => {
      const dir = makeRepo();
      fs.writeFileSync(
        path.join(dir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| existing | src/existing.ts | 条目 |\n'
      );
      const { runner, commands } = countingRunner();
      const shared = createGitEvidence(dir, runner);
      // 记录器：哪个消费者（phase）调了哪个证据方法
      const phase = { current: 'context' };
      const calls: string[] = [];
      const evidence = recordingEvidence(shared, () => phase.current, calls);

      const context = await buildConstraintContext({ projectPath: dir, staged: true, evidence });
      // capability_sync 经 CheckEnv.stagedDiffNames() 取同一份 git 证据
      const merged: MergedConstraintsConfig = {
        ironLaws: {},
        guidelines: { capability_sync: GUIDELINES['capability_sync'] },
        prompts: {},
        custom: [],
        disabled: [],
        unknownIds: [],
      };
      const checker = ConstraintChecker.getInstance();
      checker.setTraceRecorder({ record: () => undefined });
      phase.current = 'checker';
      const runResult = await checker.checkConstraints(context, merged, evidence);

      // capability_sync 确实被评估（非 skip）→ 它经 env.stagedDiffNames() 取过证据
      expect(runResult.guidelines.map(r => r.id)).toEqual(['capability_sync']);
      expect(runResult.guidelines[0].skipped).toBeUndefined();
      // 两个消费者都从注入的这一份实例取证据（checker 没有另起炉灶）
      expect(calls).toContain('context:changedFileNames');
      expect(calls).toContain('checker:changedFileNames');
      // 两侧各自需要同一份 staged 名单，合计只 spawn 一次
      expect(commands).toEqual([
        'git diff --cached --name-only',
        'git ls-tree -r --name-only HEAD',
      ]);
    });
  });
});
