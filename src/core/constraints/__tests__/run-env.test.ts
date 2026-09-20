/**
 * 运行级观察面测试（ADR-0023 决策 1/4）
 *
 * 钉五件事：① 一次运行内同一份 trace 至多读一次（懒建 + memo）；② 不同尾部窗口的口径
 * 与 `readJsonl(..., {tail})` 逐字一致（含坏行占槽位）——这是"合并两处读"不改变判定的前提；
 * ③ context-builder 用注入的 env，而不是自己再读一遍；
 * ④ 项目配置（config.yml 与自定义约束文件）一次运行一份快照（ADR-0023 决策 2：
 *    进程级缓存撤销后的口径）；
 * ⑤ 能力表一次解析多消费——两个 checker 共用同一枚 env 时文档只读一次、判定不变
 *    （ADR-0023 决策 4）。
 */

import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRunEnv, resolveRunEnv, TRACE_TAIL_WINDOW, type RunEnv } from '../run-env';
import { buildConstraintContext } from '../context-builder';
import { buildCheckEnv, normalizeCheckOutcome } from '../checkers/types';
import { docsFreshness } from '../checkers/docs-freshness';
import { capabilitySync } from '../checkers/capability-sync';
import { collectSourceFiles, reconcileCapabilities } from '../capabilities-reconcile';
import { loadRawProjectConfig } from '../../project-config-loader';
import { createProjectFixture, writeProjectConfig } from '../../../test-setup/project-fixture';
import { readJsonl } from '../../../utils/jsonl';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../../types/trace';
import type { GitEvidence } from '../git-evidence';

// ts-jest 的 namespace 导入属性不可重定义（jest.spyOn 会抛），只包一层 readFileSync
// 做读计数——其余 fs 能力用真实实现，夹具搭建与被检代码读取都不受影响
// （同一手法先例：src/__tests__/context-files-resolution.test.ts）
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

const readSpy = (fs as unknown as { readFileSync: jest.Mock }).readFileSync;
const capsReads = () =>
  readSpy.mock.calls.filter(call => String(call[0]).endsWith('CAPABILITIES.md')).length;

const tracePathOf = (projectPath: string) => path.join(projectPath, DEFAULT_TRACE_FILE);

function writeTraces(projectPath: string, lines: string[]): void {
  const file = tracePathOf(projectPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8');
}

const traceLine = (id: string, result: 'pass' | 'fail'): string =>
  JSON.stringify({ constraintId: id, severity: 'error', timestamp: 1, result });

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

describe('配置一次装载 — rawConfig（ADR-0023 决策 2）', () => {
  let dir: string;

  const writeConfig = (content: string) => writeProjectConfig(dir, content);

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
      capabilities: () => undefined,
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
      { constraintId: 'p', severity: 'error', timestamp: 1, result: 'pass' },
      { constraintId: 'f', severity: 'error', timestamp: 2, result: 'fail' },
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
      { constraintId: 'f', severity: 'error', timestamp: 2, result: 'fail' },
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

describe('capabilities — 能力表一次解析多消费（ADR-0023 决策 4）', () => {
  const TABLE = '| 能力 | 路径 | 说明 |\n|---|---|---|\n';
  /** 幽灵条目 src/gone.ts + 一个真实源文件 src/live.ts */
  const CAPS_DOC = `# C\n\n${TABLE}| 幽灵 | src/gone.ts | 已删 |\n`;

  let dir: string;

  beforeEach(() => {
    dir = createProjectFixture({
      name: 'run-env-caps',
      files: { 'CAPABILITIES.md': CAPS_DOC, 'src/live.ts': 'export const x = 1;\n' },
    });
    readSpy.mockClear();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 两个 checker 共用同一枚 env（= 一次 check run 的形状） */
  async function evaluateBoth(env: RunEnv) {
    const scan = collectSourceFiles(dir, env.sourceRoots());
    const checkEnv = buildCheckEnv(
      { operation: 'module_modification', projectPath: dir },
      { stagedDiff: async () => '', stagedDiffNames: async () => '', srcScan: () => scan },
      env
    );
    return {
      docs: normalizeCheckOutcome(await docsFreshness.evaluate(checkEnv)),
      caps: normalizeCheckOutcome(await capabilitySync.evaluate(checkEnv)),
    };
  }

  it('一次 run 内两个 checker 共用同一份读取：CAPABILITIES.md 只读一次', async () => {
    const { docs, caps } = await evaluateBoth(createRunEnv(dir));

    // 判定照旧：幽灵条目由 docs_freshness 点名，capability_sync 正常评估不 skip
    expect(docs.satisfied).toBe(false);
    expect(docs.evidence.join('\n')).toContain('src/gone.ts');
    expect(caps.skipped).toBe(false);
    expect(capsReads()).toBe(1);
  });

  it('取过之后再改文档 = 同一份内容（run 内 memo，不重复解析）', () => {
    const env = createRunEnv(dir);
    const first = env.capabilities(['src/live.ts']);
    expect(capsReads()).toBe(1);

    fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), `# C\n\n${TABLE}| 新 | src/live.ts | 在 |\n`, 'utf-8');
    expect(env.capabilities(['src/live.ts'])).toBe(first);
    expect(capsReads()).toBe(1);
  });

  it('无 CAPABILITIES.md → undefined；有文档时判定与直调对照模块同输入同结果', () => {
    const noDoc = createProjectFixture({ name: 'run-env-caps-none', files: { 'src/a.ts': 'x\n' } });
    try {
      expect(createRunEnv(noDoc).capabilities(['src/a.ts'])).toBeUndefined();
    } finally {
      fs.rmSync(noDoc, { recursive: true, force: true });
    }

    const env = createRunEnv(dir);
    const caps = env.capabilities(['src/live.ts']);
    expect(caps?.verdict.deadEntries).toEqual(
      reconcileCapabilities({
        content: caps!.content,
        populationFiles: ['src/live.ts'],
        sourceRoots: caps!.sourceRoots,
        fileExists: rel => fs.existsSync(path.join(dir, rel)),
      }).deadEntries
    );
    // 增量那一维不在上行数据面（变更清单属 git 证据 #87），共享形状里恒空
    expect(caps?.verdict.uncoveredChanges).toEqual([]);
  });

  it('源根探测与能力表共用同一份 memo：取过之后再改目录树不影响', () => {
    const env = createRunEnv(dir);
    const before = env.capabilities(['src/live.ts'])?.sourceRoots;

    fs.mkdirSync(path.join(dir, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', 'p.ts'), 'export const p = 1;\n', 'utf-8');
    expect(env.capabilities(['src/live.ts'])?.sourceRoots).toBe(before);
  });
});
