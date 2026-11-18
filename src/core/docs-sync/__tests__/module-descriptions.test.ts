/**
 * 模块描述提取：并发取数 + 逐字保序（#147 B 票）
 *
 * sync-docs 的 file-table 分支要把首行注释提成表格「说明」列。改造前是逐文件
 * `await` 串行读；改造后按固定上限并发读，但**输出清单的顺序必须与目录遍历序
 * 逐字一致**（该顺序对外经 `sync-docs --check` 的漂移校验可见，不得变）。
 *
 * 手法：替身 `fs/promises.readFile` 给每次读取记「起始序 / 完成序」，并让起始靠后
 * 的读更快完成——只要真有并发，完成序必然与起始序不同。于是「按完成顺序 append」
 * 的实现会当场红，而「按原索引回填」的实现保序。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type IoEvents = {
  /** .ts/.tsx 内容读的发起顺序（替身按调用到达顺序记账） */
  started: string[];
  /** .ts/.tsx 内容读的完成顺序 */
  finished: string[];
  inFlight: number;
  maxInFlight: number;
};

// 记账挂 globalThis：jest.mock 工厂在装载期执行，闭包外提会撞 TDZ
jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  const g = globalThis as unknown as { __SD147_IO__?: IoEvents };
  if (!g.__SD147_IO__) {
    g.__SD147_IO__ = { started: [], finished: [], inFlight: 0, maxInFlight: 0 };
  }
  const ev = g.__SD147_IO__;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    ...actual,
    readFile: jest.fn(async (p: fs.PathLike | unknown, ...rest: unknown[]) => {
      const name = Buffer.isBuffer(p) ? p.toString('utf8') : String(p);
      const tracked = /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts');
      if (tracked) {
        const startedIndex = ev.started.length;
        ev.started.push(name);
        ev.inFlight++;
        if (ev.inFlight > ev.maxInFlight) ev.maxInFlight = ev.inFlight;
        // 起始靠后的读更快落地：并发一存在，完成序就与起始序错开
        await sleep(startedIndex % 2 === 0 ? 60 : 2);
      }
      try {
        return await (
          actual.readFile as unknown as (
            path: unknown,
            options?: unknown
          ) => Promise<string | Buffer>
        )(p, ...rest);
      } finally {
        if (tracked) {
          ev.inFlight--;
          ev.finished.push(name);
        }
      }
    }),
  };
});

import { extractFileDescriptions, scanSourceModules } from '../project-reader';

const events = (): IoEvents =>
  ((globalThis as unknown as { __SD147_IO__?: IoEvents }).__SD147_IO__ ||= {
    started: [],
    finished: [],
    inFlight: 0,
    maxInFlight: 0,
  });

let tempDir: string;

function write(rel: string, content: string): void {
  const target = path.join(tempDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/** 描述 = `desc:<文件名去扩展名>`，一眼可核对配对 */
function writeModule(rel: string): void {
  const base = path.basename(rel).replace(/\.tsx?$/, '');
  write(rel, `// desc:${base}\nexport const ${/^\w+$/.test(base) ? base : 'x'} = 1;\n`);
}

function reset(): void {
  const ev = events();
  ev.started.length = 0;
  ev.finished.length = 0;
  ev.inFlight = 0;
  ev.maxInFlight = 0;
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd147-descriptions-'));
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(reset);

describe('scanSourceModules — 描述并发取数且逐字保序（#147）', () => {
  it('并发真的发生：同一时刻至多 16 份读在途，而非逐文件串行', async () => {
    const srcDir = path.join(tempDir, 'wide');
    // 20 份 > 上限：串行的话 maxInFlight 恒为 1
    for (let i = 0; i < 20; i++) {
      writeModule(`wide/m${String(i).padStart(2, '0')}.ts`);
    }
    // 子目录里的文件同样要进并发池
    writeModule('wide/nested/deep-a.ts');
    writeModule('wide/nested/deep-b.ts');

    const modules = await scanSourceModules(srcDir, tempDir);

    const ev = events();
    expect(modules).toHaveLength(22);
    expect(ev.started).toHaveLength(22);
    // 正对照：完成序与起始序确实错开了（夹具没并发能力 = 下面的断言是空跑）
    expect(ev.finished).not.toEqual(ev.started);
    expect(ev.maxInFlight).toBeGreaterThan(1);
    // 上限是固定缺省，不是「有多少文件开多少」
    expect(ev.maxInFlight).toBeLessThanOrEqual(16);
  });

  it('输出顺序 = 读取发起顺序（= 目录遍历序），描述与文件一一配对', async () => {
    const srcDir = path.join(tempDir, 'order');
    writeModule('order/zeta.ts');
    writeModule('order/alpha.ts');
    writeModule('order/mid.tsx');
    writeModule('order/sub/beta.ts');
    writeModule('order/sub/gamma.ts');

    const modules = await scanSourceModules(srcDir, tempDir);

    const ev = events();
    const relStarted = ev.started.map((f) => path.relative(tempDir, f));

    // 回填按原索引，不按完成先后：清单顺序 = 发起顺序
    expect(modules.map((m) => m.file)).toEqual(relStarted);
    // 每条描述都得是自己那份文件的（串位即红）
    expect(modules.map((m) => m.description)).toEqual(
      modules.map((m) => `desc:${path.basename(m.file).replace(/\.tsx?$/, '')}`)
    );
    // 回填既不是「按完成先后 append」，也不是按文件名重排
    expect(modules.map((m) => m.file)).not.toEqual(
      ev.finished.map((f) => path.relative(tempDir, f))
    );
  });

  it('跳过口径逐字不变：barrel / .d.ts / __tests__ 不进清单也不被读', async () => {
    const srcDir = path.join(tempDir, 'skips');
    writeModule('skips/keep.ts');
    writeModule('skips/index.ts');
    writeModule('skips/typed.tsx');
    write('skips/ambient.d.ts', '// desc:should-not-appear\nexport const nope = 1;\n');
    write('skips/__tests__/keep.test.ts', '// desc:should-not-appear\nexport const nope = 1;\n');
    write('skips/node_modules/pkg/index.ts', '// desc:should-not-appear\n');
    write('skips/dist/built.ts', '// desc:should-not-appear\n');

    const modules = await scanSourceModules(srcDir, tempDir);

    expect(modules.map((m) => m.file)).toEqual(['skips/keep.ts', 'skips/typed.tsx']);
    expect(events().started.map((f) => path.basename(f))).toEqual(['keep.ts', 'typed.tsx']);
  });

  it('两条兜底逐字保留：JSDoc 首行进描述、无注释回退文件名', async () => {
    const srcDir = path.join(tempDir, 'bare');
    write('bare/no-comment.ts', 'export const a = 1;\n');
    write('bare/jsdoc.ts', '/**\n * JSDoc 首行描述\n */\nexport const b = 2;\n');

    const modules = await scanSourceModules(srcDir, tempDir);
    const byFile = new Map(modules.map((m) => [m.file, m.description]));

    expect([...modules.map((m) => m.name)].sort()).toEqual(['jsdoc', 'no-comment']);
    expect(byFile.get('bare/jsdoc.ts')).toBe('JSDoc 首行描述');
    expect(byFile.get('bare/no-comment.ts')).toBe('no-comment');
  });

  it('读失败的文件交回文件名（并发回填不改变原 try/catch 兜底语义）', async () => {
    write('fallback/here.ts', '/**\n * 在场文件的描述\n */\nexport const c = 3;\n');

    const descriptions = await extractFileDescriptions([
      path.join(tempDir, 'fallback', 'here.ts'),
      path.join(tempDir, 'fallback', 'gone.ts'),
      path.join(tempDir, 'fallback', 'also-here.ts'),
    ]);

    expect(descriptions).toEqual(['在场文件的描述', 'gone', 'also-here']);
  });
});
