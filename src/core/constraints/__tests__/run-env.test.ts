/**
 * 运行级观察面测试（ADR-0023 决策 1/4）
 *
 * 钉四件事：① 一次运行内同一份 trace 至多读一次（懒建 + memo）；② 不同尾部窗口的口径
 * 与 `readJsonl(..., {tail})` 逐字一致（含坏行占槽位）——这是"合并两处读"不改变判定的前提；
 * ③ context-builder 用注入的 env，而不是自己再读一遍；
 * ④ 项目配置（config.yml 与自定义约束文件）一次运行一份快照（ADR-0023 决策 2：
 *    进程级缓存撤销后的口径）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRunEnv, resolveRunEnv, TRACE_TAIL_WINDOW, type RunEnv } from '../run-env';
import { buildConstraintContext } from '../context-builder';
import { loadRawProjectConfig } from '../../project-config-loader';
import { createProjectFixture, writeProjectConfig } from '../../../test-setup/project-fixture';
import { readJsonl } from '../../../utils/jsonl';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../../types/trace';
import type { GitEvidence } from '../git-evidence';

const tracePathOf = (projectPath: string) => path.join(projectPath, DEFAULT_TRACE_FILE);

function writeTraces(projectPath: string, lines: string[]): void {
  const file = tracePathOf(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
}

const traceLine = (id: string, result: 'pass' | 'fail'): string =>
  JSON.stringify({ constraintId: id, level: 'iron_law', timestamp: 1, result });

const CORRUPT = '{"constraintId":"broken"';

describe('createRunEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-run-env-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('一次运行内同一份 trace 至多读一次：取过之后再改文件，仍是老内容', () => {
    writeTraces(dir, [traceLine('a', 'pass')]);
    const env = createRunEnv(dir);
    expect(env.traceTail(1).records.map(r => r.constraintId)).toEqual(['a']);

    // 追加一条 fail：若没有 memo，第二次取会读到新尾部并判出 fail
    writeTraces(dir, [traceLine('a', 'pass'), traceLine('b', 'fail')]);
    expect(env.traceTail(2).records.map(r => r.constraintId)).toEqual(['a']);
  });

  it('懒建：造 env 不碰文件，之后落的数据才读得到', () => {
    const env = createRunEnv(dir);
    writeTraces(dir, [traceLine('late', 'fail')]);
    expect(env.traceTail(5).records.map(r => r.constraintId)).toEqual(['late']);
  });

  it('缺 trace 文件返回空窗口，不抛', () => {
    expect(createRunEnv(dir).traceTail(10)).toEqual({ records: [], skippedLines: 0 });
  });

  it('窗口口径与 readJsonl 的 tail 逐字一致（含坏行占槽位）', () => {
    const lines = [
      traceLine('old', 'fail'),
      traceLine('x1', 'pass'),
      CORRUPT,
      traceLine('x2', 'pass'),
      traceLine('x3', 'pass'),
    ];
    writeTraces(dir, lines);
    const env = createRunEnv(dir);
    const file = tracePathOf(dir);

    for (const limit of [1, 2, 3, 4, 5]) {
      expect(env.traceTail(limit)).toEqual(readJsonl<ExecutionTrace>(file, 'skip', { tail: limit }));
    }
    // 坏行占住尾部槽位：limit=3 时最近三条含一条坏行 → 有效记录只剩 2 条
    expect(env.traceTail(3).records.map(r => r.constraintId)).toEqual(['x2', 'x3']);
    expect(env.traceTail(3).skippedLines).toBe(1);
  });

  it('超过窗口上限直接抛，不静默少给', () => {
    writeTraces(dir, Array.from({ length: 40 }, (_, i) => traceLine(`t${i}`, 'pass')));
    const env = createRunEnv(dir);
    expect(() => env.traceTail(TRACE_TAIL_WINDOW + 1)).toThrow(`尾部窗口上限 ${TRACE_TAIL_WINDOW} 行`);
  });

  it('projectPath 原样带出（每个 IO 点锚同一个根，harness#95）', () => {
    expect(createRunEnv(dir).projectPath).toBe(dir);
  });

  it('sourceRoots 一次运行内至多探测一次', () => {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    const env = createRunEnv(dir);
    expect(env.sourceRoots()).toContain('src');

    // 运行中途新增源码根：memo 生效，同一份结果不再走盘
    fs.mkdirSync(path.join(dir, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', 'b.ts'), 'export const b = 1;\n');
    expect(env.sourceRoots()).not.toContain('packages');
  });
});

describe('配置一次装载 — rawConfig / customConstraints（ADR-0023 决策 2）', () => {
  let dir: string;

  const writeConfig = (content: string) => writeProjectConfig(dir, content);

  /** 落 `.harness/<fileName>`（夹具可能还没有 .harness 目录，先补上） */
  const writeHarnessFile = (fileName: string, body: string) => {
    const target = path.join(dir, '.harness', fileName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, 'utf-8');
  };

  beforeEach(() => {
    dir = createProjectFixture({ name: 'run-env-config' });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('run 内至多读一次：取过之后再改文件，仍是老内容', () => {
    writeConfig('preset: standard\n');
    const env = createRunEnv(dir);
    expect(env.rawConfig()).toEqual({ preset: 'standard' });

    writeConfig('preset: strict\n');
    expect(env.rawConfig()).toEqual({ preset: 'standard' });
  });

  it('懒建：造 env 不碰文件，之后落的配置才读得到', () => {
    const env = createRunEnv(dir);
    writeConfig('preset: minimal\n');
    expect(env.rawConfig()).toEqual({ preset: 'minimal' });
  });

  it('无 config.yml = undefined（并记住这个结论，不反复探测）', () => {
    const env = createRunEnv(dir);
    expect(env.rawConfig()).toBeUndefined();
    expect(env.rawConfig()).toBeUndefined();
  });

  it('空文件回落 {}，与改前 loadRawProjectConfig 逐字一致', () => {
    writeConfig('');
    expect(createRunEnv(dir).rawConfig()).toEqual({});
  });

  it('YAML 解析失败照抛——兜与否属消费方的判定，读面不替它决定', () => {
    writeConfig('governance: [\n  broken: {{\n');
    const env = createRunEnv(dir);
    expect(() => env.rawConfig()).toThrow();
    // 抛错不入 memo：修好文件后同一枚 env 也能读到正确内容
    writeConfig('preset: standard\n');
    expect(env.rawConfig()).toEqual({ preset: 'standard' });
  });

  it('resolveRunEnv：传 env 原样复用，传路径各自读当下内容（无进程级残留）', () => {
    writeConfig('preset: standard\n');
    const env = createRunEnv(dir);
    expect(resolveRunEnv(env)).toBe(env);
    expect(resolveRunEnv(dir).rawConfig()).toEqual({ preset: 'standard' });

    writeConfig('preset: strict\n');
    expect(loadRawProjectConfig(dir)).toEqual({ preset: 'strict' });
    expect(resolveRunEnv().projectPath).toBe(process.cwd());
  });

  it('customConstraints 取 custom_constraints 段，run 内同名文件至多读一次', () => {
    const write = (body: string) => writeHarnessFile('custom-constraints.yml', body);
    write('custom_constraints:\n  a:\n    level: iron_law\n    rule: 只此一份\n');
    const env = createRunEnv(dir);
    expect(Object.keys(env.customConstraints('custom-constraints.yml'))).toEqual(['a']);

    write('custom_constraints:\n  b:\n    level: guideline\n    rule: 后来的\n');
    expect(Object.keys(env.customConstraints('custom-constraints.yml'))).toEqual(['a']);
  });

  it('customConstraints：文件缺失 = {}；不同文件名各自 memo', () => {
    const env = createRunEnv(dir);
    expect(env.customConstraints('missing.yml')).toEqual({});

    writeHarnessFile(
      'other.yml',
      'custom_constraints:\n  c:\n    level: guideline\n    rule: r\n'
    );
    expect(Object.keys(env.customConstraints('other.yml'))).toEqual(['c']);
    expect(env.customConstraints('missing.yml')).toEqual({});
  });
});

describe('context-builder 经注入的观察面取证据', () => {
  let dir: string;

  const fakeGit = (projectPath: string, changed: string[]): GitEvidence => ({
    projectPath,
    stagedDiff: () => '',
    changedFileNames: () => changed.join('\n'),
    headDirs: () => new Set<string>(),
  });

  /** 只记次数的假观察面：records 固定，用于断言两个证据探测都从 env 取数 */
  function countingEnv(records: ExecutionTrace[]) {
    const limits: number[] = [];
    const env: RunEnv = {
      projectPath: dir,
      traceTail: (limit: number) => {
        limits.push(limit);
        return { records: limit >= records.length ? records : records.slice(-limit), skippedLines: 0 };
      },
      sourceRoots: () => ['src'],
      rawConfig: () => undefined,
      customConstraints: () => ({}),
    };
    return { env, limits };
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ctxbuilder-env-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hasFailingTest / hasVerificationEvidence 各按自己的窗口向 env 取数，不另开读', async () => {
    const { env, limits } = countingEnv([
      { constraintId: 'p', level: 'iron_law', timestamp: 1, result: 'pass' },
      { constraintId: 'f', level: 'iron_law', timestamp: 2, result: 'fail' },
    ]);
    const ctx = await buildConstraintContext({
      projectPath: dir,
      staged: false,
      evidence: fakeGit(dir, ['README.md']),
      runEnv: env,
    });

    expect(limits).toEqual([TRACE_TAIL_WINDOW, 10]);
    expect(ctx.hasFailingTest).toBe(true);
    expect(ctx.hasVerificationEvidence).toBe(true);
  });

  it('窗口里没有 pass 时验证证据为 false（合并读取不改判定）', async () => {
    const { env } = countingEnv([
      { constraintId: 'f', level: 'iron_law', timestamp: 2, result: 'fail' },
    ]);
    const ctx = await buildConstraintContext({
      projectPath: dir,
      staged: false,
      evidence: fakeGit(dir, ['README.md']),
      runEnv: env,
    });
    expect(ctx.hasFailingTest).toBe(true);
    expect(ctx.hasVerificationEvidence).toBe(false);
  });

  it('不注入 env 时自造一份并按 projectPath 锚定读取', async () => {
    writeTraces(dir, [traceLine('a', 'fail')]);
    const ctx = await buildConstraintContext({
      projectPath: dir,
      staged: false,
      evidence: fakeGit(dir, ['README.md']),
    });
    expect(ctx.hasFailingTest).toBe(true);
  });
});
