/**
 * pre-push 钩子的真 push 行为（harness#144）
 *
 * scaffold/init 测试能看到「落盘了什么字节」，看不到 git 到底怎么待见这份字节。
 * 本文件不 mock 任何 IO、也不重写一份钩子正文：在临时 git 仓库里把 `init` 落盘的
 * 那份正文（`renderPrePushHook()` 正本）连可执行位一起装上，接一个本地 bare 远端，
 * 把 PATH 上的 `npx` 换成记账替身，真跑 `git push`。按票验收标准逐条钉住：
 * 1. 整仓全量兜底生效：任一失败（check 或 validate）→ push 非零退出、远端收不到东西、
 *    输出指明是哪一道挡的；
 * 2. 两道门禁全过 → push 成功，且调用序列就是 check → validate；
 * 3. 不内建逃生机制：唯一的口子是 git 原生 `--no-verify`，它一开钩子整个人不被调用；
 * 4. 不做增量：stdin 里没有待推 ref 清单（删远端分支）时照样整仓过一遍。
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderPrePushHook } from '../scaffold-templates';

/** 替身 npx：把每次调用的参数记进日志，按环境变量决定各自退出码 */
const STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$HARNESS_NPX_LOG"
case "$*" in
  *validate*) exit \${HARNESS_VALIDATE_EXIT:-0} ;;
  *) exit \${HARNESS_CHECK_EXIT:-0} ;;
esac
`;

/** 两道门禁各自的退出码（缺省 0 = 通过） */
interface Knobs {
  check?: number;
  validate?: number;
}

interface Fixture {
  /** 工作仓库（钩子装在它的 .git/hooks/pre-push） */
  repo: string;
  branch: string;
  /** 真跑 git push（argv 数组，不经 shell） */
  push: (knobs: Knobs, ...args: string[]) => SpawnSyncReturns<string>;
  /** 替身 npx 被调用的参数清单 = 钩子里 harness 命令的真实调用序列 */
  calls: () => string[];
  resetCalls: () => void;
  remoteHeads: () => string[];
}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

function fixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-prepush-'));
  const repo = path.join(root, 'work');
  const remote = path.join(root, 'remote.git');
  const stubDir = path.join(root, 'stub');
  const log = path.join(root, 'npx.log');

  fs.mkdirSync(stubDir, { recursive: true });
  const stub = path.join(stubDir, 'npx');
  fs.writeFileSync(stub, STUB, 'utf-8');
  fs.chmodSync(stub, 0o755);

  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'fixture@example.com');
  git(repo, 'config', 'user.name', 'Fixture');
  // 仓库级钉死钩子目录：全局 core.hooksPath 会把测试变成「测别人家的钩子」
  git(repo, 'config', 'core.hooksPath', path.join(repo, '.git', 'hooks'));
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'baseline');

  // 装上 init 会落的那份正文（正本，不手抄），连可执行位一起（mode 与站点同值 0o755）
  const hook = path.join(repo, '.git', 'hooks', 'pre-push');
  fs.writeFileSync(hook, renderPrePushHook(), 'utf-8');
  fs.chmodSync(hook, 0o755);

  git(repo, 'init', '-q', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repo,
    encoding: 'utf-8',
  }).trim();

  return {
    repo,
    branch,
    push: (knobs, ...args) =>
      spawnSync('git', ['push', ...args], {
        cwd: repo,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${stubDir}:${process.env.PATH}`,
          HARNESS_NPX_LOG: log,
          HARNESS_CHECK_EXIT: String(knobs.check ?? 0),
          HARNESS_VALIDATE_EXIT: String(knobs.validate ?? 0),
        },
      }),
    calls: () =>
      fs.existsSync(log)
        ? fs
            .readFileSync(log, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
        : [],
    resetCalls: () => {
      try {
        fs.unlinkSync(log);
      } catch {
        // 首趟就没跑过钩子，无日志可清
      }
    },
    remoteHeads: () =>
      execFileSync('git', ['ls-remote', '--heads', remote], { encoding: 'utf-8' })
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean),
  };
}

const output = (r: SpawnSyncReturns<string>): string => `${r.stdout}${r.stderr}`;

describe('pre-push 钩子真挡得住 push（harness#144）', () => {
  it('两道门禁全过 → push 成功，钩子里 check 与 validate 各跑一次（check 不带 --staged）', () => {
    const f = fixture();

    const r = f.push({}, 'origin', 'HEAD');

    expect(r.status).toBe(0);
    expect(f.remoteHeads()).toHaveLength(1);
    expect(f.calls()).toEqual(['@dommaker/harness check', '@dommaker/harness validate']);
  });

  it('check 失败 → push 被挡、退出非零、输出指明是铁律检查、远端一格未收', () => {
    const f = fixture();

    const r = f.push({ check: 1 }, 'origin', 'HEAD');

    expect(r.status).not.toBe(0);
    expect(output(r)).toContain('🔍 Running harness pre-push checks (whole repo)...');
    expect(output(r)).toContain('❌ Iron law check failed');
    expect(f.calls()).toEqual(['@dommaker/harness check']);
    expect(f.remoteHeads()).toEqual([]);
  });

  it('validate 失败同样挡住 push（不是只看 check），输出指明是哪一道', () => {
    const f = fixture();

    const r = f.push({ check: 0, validate: 1 }, 'origin', 'HEAD');

    expect(r.status).not.toBe(0);
    expect(output(r)).toContain('❌ Validate failed');
    expect(f.calls()).toEqual(['@dommaker/harness check', '@dommaker/harness validate']);
    expect(f.remoteHeads()).toEqual([]);
  });

  it('唯一逃生口是 git 原生 --no-verify：失败门禁下 push 照过，钩子整个人没被调用', () => {
    const f = fixture();

    const r = f.push({ check: 1 }, '--no-verify', 'origin', 'HEAD');

    expect(r.status).toBe(0);
    expect(f.remoteHeads()).toHaveLength(1);
    expect(f.calls()).toEqual([]);
  });

  it('不做增量：删远端分支时 stdin 里没有待推 ref 清单，仍整仓跑一遍 check', () => {
    const f = fixture();
    expect(f.push({}, 'origin', 'HEAD').status).toBe(0);
    f.resetCalls();

    const r = f.push({ check: 1 }, '--delete', 'origin', f.branch);

    expect(r.status).not.toBe(0);
    expect(f.calls()).toEqual(['@dommaker/harness check']);
    expect(f.remoteHeads()).toHaveLength(1);
  });
});
