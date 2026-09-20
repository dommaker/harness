/**
 * 一次 check 运行内「每个项目文件至多读一次」计数闸（ADR-0023 决策 5 ①）
 *
 * 形状照 `check.test.ts:78-106` 的 `recordingEvidence()`：真执行、只在中间记一笔，
 * 不改任何行为。这里数的不是「观察口被请求几次」（memo 在观察面上，请求多次本就应当），
 * 而是**底层文件读取发生了几次** —— 那才是本 ADR 承诺的口径。
 *
 * 夹具必须让两个吃能力表的 checker 都真评估（触发条件 module_modification +
 * 有 CAPABILITIES.md + 有自定义约束文件），否则闸门是空跑的。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { check } from '../check';
import { captureIO, type CapturingIO } from '../../command-contract';

type ReadCall = { file: string; via: 'readFileSync' | 'open' };

// 计数器挂在 globalThis：jest.mock 工厂会被提前调用，闭包外提会撞 TDZ
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as { __ADR0023_READS__?: ReadCall[] };
  if (!g.__ADR0023_READS__) g.__ADR0023_READS__ = [];
  const bucket = g.__ADR0023_READS__;
  const name = (p: unknown): string =>
    Buffer.isBuffer(p) ? p.toString('utf8') : String(p);
  const passthrough = (fn: string) =>
    (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[fn];

  return {
    ...actual,
    readFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push({ file: name(p), via: 'readFileSync' });
      return passthrough('readFileSync')(p, ...rest);
    }),
    // 有界读走 open/fstat/read：只记只读打开（写 trace 的 append 不算读取）
    openSync: jest.fn((p: unknown, flags?: unknown, ...rest: unknown[]) => {
      if (flags === undefined || flags === 'r' || flags === 'rs') {
        bucket.push({ file: name(p), via: 'open' });
      }
      return passthrough('openSync')(p, flags, ...rest);
    }),
  };
});

const reads = () =>
  ((globalThis as unknown as { __ADR0023_READS__?: ReadCall[] }).__ADR0023_READS__ ||= []);

jest.mock('chalk', () => ({
  blue: (s: string) => s,
  yellow: (s: string) => s,
  green: (s: string) => s,
  gray: (s: string) => s,
  red: (s: string) => s,
}));

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

function write(dir: string, rel: string, content: string): void {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

const TABLE = ['| 能力 | 路径 | 说明 |', '|---|---|---|'];

/** 一个「两 checker 都会真评估」的项目：源码根下两个已登记文件 + 一条 trace */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-read-count-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  git(dir, 'config', 'user.name', 'Fixture');
  write(dir, 'README.md', '# fixture\n');
  write(dir, '.harness/config.yml', 'preset: standard\n');
  write(
    dir,
    'CAPABILITIES.md',
    ['# CAPABILITIES.md', '', ...TABLE, '| 既有 | src/existing.ts | 在 |', '| 嵌套 | src/nested/deep.ts | 在 |'].join('\n') + '\n'
  );
  write(dir, 'AGENTS.md', '<!-- PRESERVE:governance -->\n## Governance Rules\n\n条款\n\n<!-- /PRESERVE:governance -->\n');
  write(dir, 'src/existing.ts', 'export const a = 1;\n');
  write(dir, 'src/nested/deep.ts', 'export const d = 1;\n');
  write(dir, '.harness/logs/traces.log', '{"constraintId":"fixture","result":"pass"}\n');
  // ADR-0026：状态文件进夹具，智能提示的状态读取随之进计数表（一次运行至多读一次）
  write(dir, '.harness/.state.json', '{}');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'baseline');
  // 改一个已登记的源文件并 stage → 触发条件 module_modification
  write(dir, 'src/existing.ts', 'export const a = 2;\n');
  git(dir, 'add', '--', 'src/existing.ts');
  return dir;
}

describe('一次 check 的文件读取计数闸（ADR-0023 决策 5 ①）', () => {
  let io: CapturingIO;
  let dir: string;

  /** 相对项目根的文件名 → 读取次数（只读语义的 readFileSync 与只读 open 都算一次） */
  function readCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const call of reads()) {
      const rel = path.relative(dir, call.file);
      if (!rel || rel.startsWith('..')) continue; // 非本项目文件（模块加载等）不计
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
    }
    return counts;
  }

  beforeEach(() => {
    // 原地清空：mock 工厂在装载时就captured了这个数组引用，换新数组计数会落到旧的去向（假绿）
    reads().length = 0;
    io = captureIO();
    dir = fixtureRepo();
    // trace 自 #139 起锚在 projectPath 上写入（本夹具内），写入不经读取计数器
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('整张读取表如实冻结：本次运行读了哪些项目文件、各读几次', async () => {
    const result = await check({ staged: true, projectPath: dir }, io);
    expect(result.kind).toBe('ok');
    // 正对照：两个吃能力表的 checker 确实跑了（否则下面的断言是空跑）
    expect(io.outText()).toContain('触发条件: module_modification');

    expect([...readCounts().entries()].sort()).toEqual(
      [
        // —— 一次运行一份：本 ADR 的承诺面 ——
        ['.harness/config.yml', 1],
        ['CAPABILITIES.md', 1],
        ['.harness/logs/traces.log', 2],
        ['.harness/.state.json', 1], // ADR-0026：智能提示经 StateIO 读状态，恰一次
        ['AGENTS.md', 1],
        // —— 已知例外（改动需明写理由）——
        // traces.log = 2：head 50（智能提示的阈值判定，决策 3）与 tail 20（有无失败证据，
        // 决策 4）是两个不同窗口的**有界**读；并成一个窗口就等于回到整读。
        // AGENTS.md = 1：ADR-0029 注入漂移检测与 custom 约束面关停后，治理文档只剩
        // governance_presence 一处读者（夹具 CLAUDE.md 不存在且不再被探测，归零）。
      ].sort()
    );
  });

  it('除上表点名例外外的项目文件，一次运行内一律至多读一次', async () => {
    await check({ staged: true, projectPath: dir }, io);

    const except = new Set([
      path.join('.harness', 'logs', 'traces.log'), // 两个窗口的有界读，见上表理由
    ]);
    const offenders = [...readCounts()].filter(
      ([file, n]) => !except.has(file) && n > 1
    );
    expect(offenders).toEqual([]);
  });
});
