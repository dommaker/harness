/**
 * bin 侧退出码映射测试（架构评审候选7）
 *
 * 命令实现只返回 CommandResult，`process.exit` 的唯一出口在 bin/harness.js。
 * 两层证据：
 * 1. exitCodeFor 纯映射：四种 kind + 契约违规（未知/缺失 kind）fail-closed；
 * 2. 端到端 spawn bin/harness.js（dist 存在时）：真实命令的对外退出码
 *    ——断言进程 status，不用 spyOn(process,'exit')。
 * 另加零 process.exit 的源码护栏（命令实现/定义表目录）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { exitCodeFor } = require('../../../../bin/harness.js');

const repoRoot = path.join(__dirname, '..', '..', '..', '..');
const distBin = path.join(repoRoot, 'bin', 'harness.js');
const distCommands = path.join(repoRoot, 'dist', 'cli', 'commands');
const hasDist = fs.existsSync(distCommands);

describe('exitCodeFor：kind → 退出码唯一映射', () => {
  it('ok / skip → 0（现状对外码面只有 0/1，skip 不新增码值）', () => {
    expect(exitCodeFor({ kind: 'ok' })).toBe(0);
    expect(exitCodeFor({ kind: 'skip' })).toBe(0);
    expect(exitCodeFor({ kind: 'skip', reason: '没有定义检查点' })).toBe(0);
  });

  it('fail / usage-error → 1', () => {
    expect(exitCodeFor({ kind: 'fail', reason: 'gate branch: 非 master' })).toBe(1);
    expect(exitCodeFor({ kind: 'usage-error', reason: '缺少关键词' })).toBe(1);
  });

  it('未知或缺失 kind → fail-closed（命令契约违规不得静默通过）', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation();
    try {
      expect(exitCodeFor({ kind: 'exploded' })).toBe(1);
      expect(exitCodeFor(undefined)).toBe(1);
      expect(exitCodeFor({})).toBe(1);
      expect(errSpy).toHaveBeenCalledTimes(3);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('命令实现/定义表目录零 process.exit（唯一出口在 bin）', () => {
  const dirs = [
    path.join(repoRoot, 'src', 'cli', 'commands'),
    path.join(repoRoot, 'src', 'cli', 'commands', 'sync-docs'),
  ];

  it.each(dirs.map(d => [d]))('%s', (dir: string) => {
    const offenders = fs.readdirSync(dir)
      .filter(f => f.endsWith('.ts') && !f.includes('.test.'))
      .filter(f => fs.readFileSync(path.join(dir, f), 'utf-8').includes('process.exit'))
      .map(f => `${dir}/${f}`);
    expect(offenders).toEqual([]);
  });

  it('bin/harness.js 只有一处 process.exit 调用点', () => {
    const source = fs.readFileSync(distBin, 'utf-8');
    const calls = [...source.matchAll(/process\.exit\(/g)];
    expect(calls).toHaveLength(1);
  });
});

const smoke = hasDist ? describe : describe.skip;

smoke('端到端：真实命令经 bin 映射后的对外退出码', () => {
  const run = (argv: string[]) => spawnSync(process.execPath, [distBin, ...argv], {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 60000,
  });

  it('放行命令 → 0（返回 ok，进程自然退出）', () => {
    const r = run(['command', 'ls']);
    expect(r.status).toBe(0);
  });

  it('门禁否决 → 1（返回 fail，bin 映射）', () => {
    const r = run(['command', 'rm -rf /']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('✗');
  });

  it('用法错误 → 1（返回 usage-error）', () => {
    const r = run(['kb', 's']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('请提供搜索关键词');
  });

  it('bin 自身子命令路由错误 → 1', () => {
    const r = run(['knowledge', 'bogus']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('未知子命令: bogus');
  });
});
