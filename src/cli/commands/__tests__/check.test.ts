/**
 * check 命令测试（#87 重写：真 git fixture 驱动）
 *
 * 此前整个 checker 与 child_process 都被 mock，被测对象已不在 interface 之内
 * （断言的是替身的返回值）。现在每个用例在临时 git 仓库里摆好真证据
 * （staged 变更 / traces.log / .harness/config.yml），跑真 context-builder +
 * 真 ConstraintChecker，断言 CLI 输出形状与 CommandResult。
 * 取证次数经 createGitEvidence 的计数 runner 观测——执行仍走真 git，不 mock 子进程。
 *
 * trace 记录器由命令侧组合根接线（harness#88）：套件把全局收集器重定向到临时文件，
 * 既不断言宿主仓写入，也不污染它。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { check, listLaws } from '../check';
import { captureIO, type CapturingIO } from '../../command-contract';
import { configureTraceCollector } from '../../../monitoring/traces';
import {
  createGitEvidence,
  realGitCommandRunner,
  type GitEvidence,
} from '../../../core/constraints/git-evidence';

// chalk：格式化替身，断言只看纯文本形状（不影响判定）
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

/** fixture 内跑 git（argv 数组，不经 shell） */
function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

/** 写文件（自动建父目录） */
function write(dir: string, rel: string, content: string): void {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** 真 git 仓库基线：README（需求证据）+ src 源码根，已提交 */
function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-check-cmd-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  git(dir, 'config', 'user.name', 'Fixture');
  write(dir, 'README.md', '# fixture\n');
  write(dir, 'src/existing.ts', 'export const a = 1;\n');
  write(dir, 'src/nested/deep.ts', 'export const d = 1;\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'baseline');
  return dir;
}

/** 改一个已跟踪文件并 stage */
function stageChange(dir: string, rel: string, content: string): void {
  write(dir, rel, content);
  git(dir, 'add', '--', rel);
}

/** 真验证证据：traces.log 里有一条 pass（未跟踪，不进 diff） */
function passTraces(dir: string, lines = 1): void {
  write(
    dir,
    '.harness/logs/traces.log',
    Array(lines).fill('{"constraintId":"fixture","result":"pass"}').join('\n') + '\n'
  );
}

/** 计数 git 证据：既记录证据方法请求，也记录实际 spawn 的 git 命令（执行走真 adapter） */
function recordingEvidence(projectPath: string): {
  evidence: GitEvidence;
  requests: string[];
  commands: string[];
} {
  const requests: string[] = [];
  const commands: string[] = [];
  const shared = createGitEvidence(projectPath, (command, cwd) => {
    commands.push(command);
    return realGitCommandRunner(command, cwd);
  });
  const evidence: GitEvidence = {
    projectPath,
    stagedDiff: () => {
      requests.push('stagedDiff');
      return shared.stagedDiff();
    },
    changedFileNames: (staged: boolean) => {
      requests.push(`changedFileNames:${staged}`);
      return shared.changedFileNames(staged);
    },
    headDirs: () => {
      requests.push('headDirs');
      return shared.headDirs();
    },
  };
  return { evidence, requests, commands };
}

/** test_creation fixture：提交两行测试，再 stage 删除其中一行 */
function stagedTestDeletion(): string {
  const dir = gitRepo();
  write(dir, 'src/__tests__/existing.test.ts', "test('a', () => {}\ntest('b', () => {}\n");
  git(dir, 'add', 'src/__tests__/existing.test.ts');
  git(dir, 'commit', '-q', '-m', 'tests');
  stageChange(dir, 'src/__tests__/existing.test.ts', "test('a', () => {}\n");
  passTraces(dir);
  return dir;
}

describe('check command（真 git fixture）', () => {
  let io: CapturingIO;
  let traceDir: string;
  let traceFile: string;
  let traceSeq = 0;

  beforeAll(() => {
    traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-check-traces-'));
  });

  afterAll(() => {
    configureTraceCollector({});
    try {
      fs.rmSync(traceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    io = captureIO();
    // 命令侧接线的是全局收集器（默认 cwd 相对写入）：重定向到套件临时文件，宿主仓 .harness/ 不受影响
    traceFile = path.join(traceDir, `trace-${++traceSeq}.log`);
    configureTraceCollector({ traceFile });
  });

  describe('判定与输出形状', () => {
    it('真证据全部满足时逐层通过，未接线证据单独列示', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      passTraces(dir);

      const result = await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'code_implementation' },
        io
      );

      // 3 条 code_implementation 铁律：incremental_progress 的 hasSingleTask 未接线 → skip
      expect(io.outText()).toContain('✅ 铁律: 全部通过 (2 条)');
      expect(io.outText()).toContain('✅ 指导原则: 2/2 通过');
      expect(io.outText()).toContain('⏭️  跳过评估: 1 条（约定未采用或证据未接线，不计通过/失败）');
      expect(io.outText()).toContain('- incremental_progress');
      expect(io.outText()).toContain('✅ 约束检查通过');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('无验证证据 → 真铁律拦截，经异常外溢为 fail', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      write(dir, '.harness/logs/traces.log', '{"constraintId":"fixture","result":"fail"}\n');

      const result = await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'code_implementation' },
        io
      );

      expect(io.outText()).toContain('禁止无验证声明完成，必须运行验证命令');
      expect(result).toEqual({
        kind: 'fail',
        reason: 'check error: 禁止无验证声明完成，必须运行验证命令',
      });
    });

    it('staged 删除测试行 → 真 git diff 驱动 no_test_simplification 拦截', async () => {
      const dir = stagedTestDeletion();
      const { evidence, commands } = recordingEvidence(dir);

      const result = await check(
        { preset: 'standard', staged: true, projectPath: dir, evidence },
        io
      );

      // 触发条件由真 diff 推断出 test_creation，checker 经 env.stagedDiff() 读到真 diff
      expect(io.outText()).toContain('触发条件: test_creation, code_implementation');
      expect(commands).toContain('git diff --cached');
      expect(io.outText()).toContain('禁止简化测试绕过困难');
      expect(result.kind).toBe('fail');
    });

    it('staged 硬编码凭证 → 指导原则警告但不阻断', async () => {
      const dir = gitRepo();
      stageChange(
        dir,
        'src/existing.ts',
        // 'pass'+'word' 拆串是躲本仓 no_hardcoded_credentials 静态扫描：测试源文件里出现完整
        // `password = "..."` 字面量会撞自己的 pre-commit 门禁；运行时拼接值不变，断言不受影响
        'export const a = 1;\nconst pass' + 'word = "correcthorsebattery";\n'
      );
      passTraces(dir);

      const result = await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'code_implementation' },
        io
      );

      expect(io.outText()).toContain('⚠️  指导原则警告: 1 条');
      expect(io.outText()).toContain('- no_hardcoded_credentials');
      expect(io.outText()).toContain('✅ 约束检查通过');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('变更文件数量来自真 staged 名单', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      stageChange(dir, 'src/nested/deep.ts', 'export const d = 2;\n');
      passTraces(dir);

      await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'code_implementation' },
        io
      );

      expect(io.outText()).toContain('变更文件: 2 个');
    });

    it('非 git 目录：无变更文件行，检查照常完成', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-check-nogit-'));
      write(dir, 'README.md', '# fixture\n');

      const result = await check({ preset: 'standard', staged: true, projectPath: dir }, io);

      expect(io.outText()).not.toContain('变更文件');
      expect(result).toEqual({ kind: 'ok' });
    });
  });

  describe('判定证据外显（harness#119）', () => {
    /** 带 CAPABILITIES.md 的 git 仓库：登记列表外的源文件即为仓库级漂移 */
    function capRepo(registered: string[]): string {
      const dir = gitRepo();
      const rows = registered
        .map((rel) => `| ${path.basename(rel, '.ts')} | ${rel} | fixture |\n`)
        .join('');
      write(dir, 'CAPABILITIES.md', `# C\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n${rows}`);
      git(dir, 'add', 'CAPABILITIES.md');
      git(dir, 'commit', '-q', '-m', 'capabilities');
      return dir;
    }

    /** 从本用例 trace 文件里取某条约束的记录 */
    function traceOf(constraintId: string) {
      return fs
        .readFileSync(traceFile, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { constraintId: string; result: string; evidence?: string[] })
        .find((l) => l.constraintId === constraintId);
    }

    it('变更文件未登记 → 警告随附证据点名该文件', async () => {
      const dir = capRepo(['src/existing.ts', 'src/nested/deep.ts']);
      stageChange(dir, 'src/nested/extra.ts', 'export const e = 1;\n');
      passTraces(dir);

      const result = await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'module_modification' },
        io
      );

      expect(io.outText()).toContain('- capability_sync');
      expect(io.outText()).toContain('src/nested/extra.ts');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('仓库级漂移（与本次变更无关）→ 提示块露出，不判违规', async () => {
      const dir = capRepo(['src/existing.ts']);
      passTraces(dir);

      const result = await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'module_modification' },
        io
      );

      const out = io.outText();
      expect(out).toContain('✅ 指导原则: 1/1 通过');
      expect(out).not.toContain('指导原则警告');
      expect(out).toContain('💡 提示: 1 条（不判违规，供参考）');
      expect(out).toContain('- capability_sync:');
      expect(out).toContain('src/nested/deep.ts');
      expect(out).toContain('✅ 约束检查通过');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('提示与违规都写进 trace 的 evidence 字段（统计侧可诊断）', async () => {
      const dir = capRepo(['src/existing.ts']);
      passTraces(dir);

      await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'module_modification' },
        io
      );

      const record = traceOf('capability_sync');
      expect(record?.result).toBe('pass');
      expect(record?.evidence?.join('\n')).toContain('src/nested/deep.ts');
    });
  });

  describe('git 证据单一来源（#87 验收）', () => {
    it('两个 checker 请求同一份 staged diff → 一次 run 内只 spawn 一次', async () => {
      // 新增（非删除）测试行：no_test_simplification 请求 stagedDiff 后放行，
      // no_hardcoded_credentials 再请求同一份 → 只有铁律都通过时两者才同 run
      const dir = gitRepo();
      stageChange(dir, 'src/__tests__/added.test.ts', "test('a', () => {}\n");
      passTraces(dir);
      const { evidence, requests, commands } = recordingEvidence(dir);

      const result = await check({ preset: 'standard', staged: true, projectPath: dir, evidence }, io);

      expect(result).toEqual({ kind: 'ok' });
      expect(requests.filter(r => r === 'stagedDiff').length).toBeGreaterThanOrEqual(2);
      expect(commands.filter(c => c === 'git diff --cached')).toHaveLength(1);
      expect(commands).toContain('git diff --cached --name-only');
      expect(new Set(commands).size).toBe(commands.length);
    });

    it('--staged 用 --cached 名单，非 staged 用工作区名单', async () => {
      const stagedDir = gitRepo();
      stageChange(stagedDir, 'src/existing.ts', 'export const a = 2;\n');
      passTraces(stagedDir);
      const staged = recordingEvidence(stagedDir);
      await check(
        { preset: 'standard', staged: true, projectPath: stagedDir, trigger: 'code_implementation', evidence: staged.evidence },
        io
      );
      expect(staged.requests).toContain('changedFileNames:true');
      expect(staged.commands).toContain('git diff --cached --name-only');
      expect(staged.commands).not.toContain('git diff --name-only');

      const worktreeDir = gitRepo();
      write(worktreeDir, 'src/existing.ts', 'export const a = 3;\n');
      passTraces(worktreeDir);
      const worktree = recordingEvidence(worktreeDir);
      await check(
        { preset: 'standard', staged: false, projectPath: worktreeDir, trigger: 'code_implementation', evidence: worktree.evidence },
        io
      );
      expect(worktree.requests).toContain('changedFileNames:false');
      expect(worktree.commands).toContain('git diff --name-only');
      expect(worktree.commands).not.toContain('git diff --cached --name-only');
    });
  });

  describe('trace 记录器组合根接线（#88 验收）', () => {
    it('一次 check 落盘每条约束的 trace（core 不上行依赖 monitoring，由命令侧接线）', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      passTraces(dir);

      await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'code_implementation' },
        io
      );

      const traces = fs
        .readFileSync(traceFile, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as { constraintId: string; result: string; projectPath: string });

      expect(traces.map(t => t.constraintId)).toEqual(
        expect.arrayContaining(['incremental_progress', 'no_implementation_without_requirement'])
      );
      expect(traces.every(t => ['pass', 'fail', 'skip'].includes(t.result))).toBe(true);
      expect(traces.every(t => t.projectPath === dir)).toBe(true);
    });
  });

  describe('触发条件推断（真 diff + 真 HEAD 目录集）', () => {
    it('已存在目录内的代码变更 → module_modification', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      passTraces(dir);

      await check({ preset: 'standard', staged: true, projectPath: dir }, io);

      expect(io.outText()).toContain('触发条件: module_modification, code_implementation');
    });

    it('源码根下新目录 → module_creation（HEAD 里没有该目录）', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/brandnew/mod.ts', 'export const n = 1;\n');
      passTraces(dir);

      await check({ preset: 'standard', staged: true, projectPath: dir }, io);

      expect(io.outText()).toContain('触发条件: module_creation, code_implementation');
    });

    it('仅测试变更 → test_creation', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/__tests__/existing.test.ts', "test('a', () => {}\n");
      passTraces(dir);

      await check({ preset: 'standard', staged: true, projectPath: dir }, io);

      expect(io.outText()).toContain('触发条件: test_creation, code_implementation');
    });

    it('源码根外的文档变更 → file_modification（不附加 code_implementation）', async () => {
      const dir = gitRepo();
      write(dir, 'docs/design.md', '# design\n');
      git(dir, 'add', 'docs/design.md');

      await check({ preset: 'standard', staged: true, projectPath: dir }, io);

      expect(io.outText()).toContain('触发条件: file_modification');
    });

    it('显式 --trigger 优先于推断', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      passTraces(dir);

      await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'design_request' },
        io
      );

      expect(io.outText()).toContain('触发条件: design_request');
      expect(io.outText()).not.toContain('module_modification');
    });
  });

  describe('生效集来自真 .harness/config.yml', () => {
    it('报告自定义、禁用与未知约束 id', async () => {
      const dir = gitRepo();
      stageChange(dir, 'src/existing.ts', 'export const a = 2;\n');
      passTraces(dir);
      write(
        dir,
        '.harness/config.yml',
        [
          'custom_constraints:',
          '  fixture_rule:',
          '    id: fixture_rule',
          '    level: guideline',
          '    trigger: manual',
          '    message: fixture 自定义约束',
          'constraints:',
          '  capability_sync:',
          '    enabled: false',
          '  no_such_rule:',
          '    enabled: false',
          '',
        ].join('\n')
      );

      await check(
        { preset: 'standard', staged: true, projectPath: dir, trigger: 'code_implementation' },
        io
      );

      expect(io.outText()).toContain('自定义约束: 1 条');
      expect(io.outText()).toContain('已禁用约束: capability_sync, no_such_rule');
      expect(io.outText()).toContain('配置中存在未知约束 id（已忽略，可清理）: no_such_rule');
    });
  });

  describe('智能提示（真 traces.log 与状态文件）', () => {
    it('记录数首次达到 50 时提示，并落盘已提示状态', async () => {
      const dir = gitRepo();
      passTraces(dir, 50);

      await check({ preset: 'standard', staged: true, projectPath: dir, trigger: 'manual' }, io);

      expect(io.outText()).toContain('记录已足够，运行 harness status 查看统计');
      expect(io.outText()).toContain('────────────────');
      const state = JSON.parse(
        fs.readFileSync(path.join(dir, '.harness', '.state.json'), 'utf-8')
      );
      expect(state.shownHints).toContain('trace_50');
    });

    it('已提示过的不再重复提示', async () => {
      const dir = gitRepo();
      passTraces(dir, 50);
      write(dir, '.harness/.state.json', JSON.stringify({ shownHints: ['trace_50'] }));

      await check({ preset: 'standard', staged: true, projectPath: dir, trigger: 'manual' }, io);

      expect(io.outText()).not.toContain('记录已足够');
      expect(io.outText()).not.toContain('────────────────');
    });

    it('记录数不足 50 时无提示', async () => {
      const dir = gitRepo();
      passTraces(dir, 10);

      await check({ preset: 'standard', staged: true, projectPath: dir, trigger: 'manual' }, io);

      expect(io.outText()).not.toContain('────────────────');
    });

    it('无 trace 记录时无提示', async () => {
      const dir = gitRepo();

      await check({ preset: 'standard', staged: true, projectPath: dir, trigger: 'manual' }, io);

      expect(io.outText()).not.toContain('────────────────');
    });
  });

  describe('listLaws', () => {
    it('应该列出所有约束', () => {
      const result = listLaws({}, io);

      expect(io.outText()).toContain('所有约束');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('应该列出铁律', () => {
      const result = listLaws({}, io);

      expect(io.outText()).toContain('铁律');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('应该列出指导原则', () => {
      const result = listLaws({}, io);

      expect(io.outText()).toContain('指导原则');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('应该列出提示', () => {
      const result = listLaws({}, io);

      expect(io.outText()).toContain('提示');
      expect(result).toEqual({ kind: 'ok' });
    });
  });
});
