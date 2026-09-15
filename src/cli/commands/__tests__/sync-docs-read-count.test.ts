/**
 * sync-docs 的 .ts 内容读取计数闸（#147 B 票，母票 #140「verifier 自己找文件」之二）
 *
 * 形状照 `check-read-count.test.ts` / `spec-baseline-read-count.test.ts`：真执行、
 * 只在中间记一笔，不改任何行为。数的是**底层文件内容读取发生了几次**。
 *
 * 本票的承诺面 = **capability-listing 格式下模块清单无人消费，一份 `.ts` 内容都不读**
 * （改造前：入口无条件全树扫描，逐文件 `await readFile` 只为首行注释）。
 * 反证用同一棵源码树换成 file-table 格式：描述照旧提取，每份文件一次运行内恰读一次。
 *
 * 夹具一律不放 CONTEXT.md：CONTEXT 侧的 `.ts` 读取属导出面采集（#142），不在本票范围，
 * 放进来会把「扫描分支零内容读」这条闸洗成模糊口径。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { syncDocs } from '../sync-docs';
import { captureIO, type CapturingIO } from '../../command-contract';

type ReadCall = { file: string; via: 'readFile' | 'readFileSync' };

// 计数器挂在 globalThis：jest.mock 工厂会被提前调用，闭包外提会撞 TDZ
jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  const g = globalThis as unknown as { __SD147_READS__?: ReadCall[] };
  if (!g.__SD147_READS__) g.__SD147_READS__ = [];
  const bucket = g.__SD147_READS__;
  const name = (p: unknown): string => (Buffer.isBuffer(p) ? p.toString('utf8') : String(p));

  return {
    ...actual,
    readFile: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push({ file: name(p), via: 'readFile' });
      return actual.readFile(p as fs.PathLike, ...(rest as [BufferEncoding])) as Promise<string>;
    }),
  };
});

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as { __SD147_READS__?: ReadCall[] };
  if (!g.__SD147_READS__) g.__SD147_READS__ = [];
  const bucket = g.__SD147_READS__;
  const name = (p: unknown): string => (Buffer.isBuffer(p) ? p.toString('utf8') : String(p));

  return {
    ...actual,
    readFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push({ file: name(p), via: 'readFileSync' });
      return (actual.readFileSync as unknown as (path: unknown, options?: unknown) => unknown)(
        p,
        ...rest
      );
    }),
  };
});

const reads = () =>
  ((globalThis as unknown as { __SD147_READS__?: ReadCall[] }).__SD147_READS__ ||= []);

const SOURCE_FILES = [
  'src/alpha.ts',
  'src/beta.tsx',
  'src/nested/gamma.ts',
  'src/nested/deep/delta.ts',
];

/** 清单格式与文件表格式共用的源码树（含三处必须被跳过口径排除的同名内容） */
function fixtureProject(capabilities: 'listing' | 'table' | 'absent'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd147-read-count-'));
  const write = (rel: string, content: string): void => {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  };

  write('src/alpha.ts', '// alpha 的描述\nexport const a = 1;\n');
  write('src/beta.tsx', 'export const b = 1;\n');
  write('src/nested/gamma.ts', '/**\n * gamma 的描述\n */\nexport const c = 1;\n');
  write('src/nested/deep/delta.ts', 'export const d = 1;\n');
  // 跳过口径的三份对照：barrel、.d.ts、__tests__（外加 node_modules 与 dist）
  write('src/index.ts', 'export * from "./alpha";\n');
  write('src/ambient.d.ts', 'export const t = 1;\n');
  write('src/__tests__/alpha.test.ts', '// 不该被读\nexport const x = 1;\n');
  write('src/node_modules/pkg/index.ts', '// 不该被读\n');
  write('src/dist/built.ts', '// 不该被读\n');

  if (capabilities === 'listing') {
    write(
      'CAPABILITIES.md',
      '# Harness Capabilities\n\n## CLI Commands (21)\ncheck, validate, sync-docs\n'
    );
  } else if (capabilities === 'table') {
    write(
      'CAPABILITIES.md',
      [
        '# Harness Capabilities',
        '',
        '| 模块 | 文件 | 说明 |',
        '|------|------|------|',
        '| alpha | src/alpha.ts | alpha 的描述 |',
        '',
      ].join('\n')
    );
  }
  return dir;
}

const isTsContent = (rel: string): boolean => /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts');

describe('sync-docs 的 .ts 内容读取计数闸（#147）', () => {
  let io: CapturingIO;
  let dir: string;

  /** 相对项目根的落点 → 内容读取次数（readFileSync 与异步 readFile 各算一次） */
  function contentCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const call of reads()) {
      const rel = path.relative(dir, call.file);
      if (!rel || rel.startsWith('..')) continue; // 非本项目文件（模块加载等）不计
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
    }
    return counts;
  }

  function tsContentReads(): Array<[string, number]> {
    return [...contentCounts().entries()].filter(([rel]) => isTsContent(rel)).sort();
  }

  beforeEach(() => {
    // 原地清空：mock 工厂在装载时就 captured 了这个数组引用，换新数组计数会落到旧的去向（假绿）
    reads().length = 0;
    io = captureIO();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('capability-listing 模式：模块清单无人消费 → 一份 .ts 内容都不读', async () => {
    dir = fixtureProject('listing');

    await syncDocs({ projectPath: dir, check: true, json: true }, io);

    // 正对照：真走了 listing 分支（否则下面的 0 是空跑出来的）
    expect(JSON.parse(io.outText()).format).toBe('capability-listing');
    expect(tsContentReads()).toEqual([]);
  });

  it('反证：file-table 格式照旧逐文件取描述，且每份文件一次运行内恰读一次', async () => {
    dir = fixtureProject('table');

    await syncDocs({ projectPath: dir, check: true, json: true }, io);

    // 正对照：走了 file-table 分支，描述确实进了对外 JSON（判定面未被这次改造削掉）
    const json = JSON.parse(io.outText());
    expect(json.format).toBe('file-table');
    const described = json.added.map(
      (a: { module: { file: string; description: string } }) => `${a.module.file}#${a.module.description}`
    );
    expect(described.sort()).toEqual([
      'src/beta.tsx#beta',
      'src/nested/deep/delta.ts#delta',
      'src/nested/gamma.ts#gamma 的描述',
    ]);

    expect(tsContentReads()).toEqual(
      SOURCE_FILES.map((f) => [f, 1]).sort()
    );
  });

  it('CAPABILITIES.md 缺席时同样走 file-table 分支：读取表只含源码清单那几份文件', async () => {
    dir = fixtureProject('absent');

    await syncDocs({ projectPath: dir, check: true, json: true }, io);

    expect(JSON.parse(io.outText()).format).toBe('file-table');
    expect(tsContentReads()).toEqual(SOURCE_FILES.map((f) => [f, 1]).sort());
  });

  it('listing 模式的整张读取表冻结：本次运行只碰 CAPABILITIES.md，源码树零读取', async () => {
    dir = fixtureProject('listing');

    await syncDocs({ projectPath: dir, check: true, json: true }, io);

    expect([...contentCounts().entries()].sort()).toEqual([['CAPABILITIES.md', 5]]);
    // CAPABILITIES.md = 5 是**本票范围外的既有重复读**：入口一次异步读 + 计数核对
    // （checkCapabilityCounts → FreshnessRunner 每条计数规则各读一次）。此处如实冻结，
    // 既不为它改动也不放行——数字变了就是扫描分支被改动的信号（登记在 #147 resolution）。
  });
});
