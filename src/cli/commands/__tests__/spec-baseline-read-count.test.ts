/**
 * 一次 spec-baseline-check 运行内的读取计数闸（#146，母票 #140 A 票）
 *
 * 形状照 `check-read-count.test.ts`（ADR-0023 决策 5 ①）：真执行、只在中间记一笔，
 * 不改任何行为。数的是**底层文件读取发生了几次**，不是观察口被请求几次。
 *
 * 夹具必须让三条验证路径（文件存在性 / 依赖 / 代码模式）都真评估，否则闸门是空跑的：
 * `package.json 文件存在` 走第一条，`依赖 … 已安装` 走第二条，`… 已实现` 走第三条。
 *
 * 本票的承诺面 = 全仓内容扫描与 `package.json` 解析各「一次运行一遍」，与前置条件条数
 * （N）、每条的关键词数（K）无关。故除整表冻结外，另有一条 N×K 缩放不变式（第三例）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { specBaselineCheck } from '../spec-baseline-check';
import { captureIO, type CapturingIO } from '../../command-contract';

type ReadCall = { file: string; via: 'readFileSync' | 'open' | 'readdir' | 'exists' };

// 计数器挂在 globalThis：jest.mock 工厂会被提前调用，闭包外提会撞 TDZ
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as {
    __SBC146_READS__?: ReadCall[];
    __SBC146_DIRS__?: string[];
  };
  if (!g.__SBC146_READS__) g.__SBC146_READS__ = [];
  if (!g.__SBC146_DIRS__) g.__SBC146_DIRS__ = [];
  const bucket = g.__SBC146_READS__;
  const dirs = g.__SBC146_DIRS__;
  const name = (p: unknown): string => (Buffer.isBuffer(p) ? p.toString('utf8') : String(p));
  const passthrough = (fn: string) =>
    (actual as unknown as Record<string, (...args: unknown[]) => unknown>)[fn];

  return {
    ...actual,
    readFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push({ file: name(p), via: 'readFileSync' });
      return passthrough('readFileSync')(p, ...rest);
    }),
    // 只读打开也算一次读取（写操作不计）
    openSync: jest.fn((p: unknown, flags?: unknown, ...rest: unknown[]) => {
      if (flags === undefined || flags === 'r' || flags === 'rs') {
        bucket.push({ file: name(p), via: 'open' });
      }
      return passthrough('openSync')(p, flags, ...rest);
    }),
    // 存在性探测（stat 口径）单列一条：同一落点在一次运行内问两次也只问一次
    existsSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push({ file: name(p), via: 'exists' });
      return passthrough('existsSync')(p, ...rest);
    }),
    // 目录列举单独计件：全仓 walk 的次数就是「扫描发生了几遍」的口径
    readdirSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      dirs.push(name(p));
      return passthrough('readdirSync')(p, ...rest);
    }),
  };
});

const reads = () =>
  ((globalThis as unknown as { __SBC146_READS__?: ReadCall[] }).__SBC146_READS__ ||= []);
const dirs = () =>
  ((globalThis as unknown as { __SBC146_DIRS__?: string[] }).__SBC146_DIRS__ ||= []);

function write(dir: string, rel: string, content: string): void {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/** 源码 6 份（walk 口径内）+ 三份必须被跳过的同名内容 + package.json 与 spec 落点 */
function fixtureProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbc-read-count-'));
  write(
    dir,
    'package.json',
    JSON.stringify({
      name: 'sbc-fixture',
      dependencies: { 'left-pad': '^1.0.0' },
      devDependencies: { '@types/right-pad': '^1.0.0' },
    })
  );
  write(dir, 'src/a.ts', 'export const a = "alphaOne";\nexport const a2 = "alphaOne again";\n');
  write(dir, 'src/b.ts', 'export const b = "betaTwo";\n');
  write(dir, 'src/c.ts', 'export const c = "gammaThree";\n');
  write(dir, 'src/d.ts', 'export const d = "zetaSix";\n');
  write(dir, 'src/nested/e.ts', 'export const e = "alphaOne";\n');
  write(dir, 'tools.js', 'module.exports = "epsilonFive";\n');
  // 以下三处内容与上面的关键词重叠，但都在 walk 的跳过名单里（node_modules / dist / 隐藏目录）
  write(dir, 'dist/ignored.ts', 'export const x = "alphaOne betaTwo gammaThree";\n');
  write(dir, 'node_modules/pkg/index.ts', 'export const x = "alphaOne betaTwo gammaThree";\n');
  write(dir, '.harness/hidden.ts', 'export const x = "alphaOne betaTwo gammaThree";\n');
  // 只活在 node_modules 里的包：依赖检查的兜底落点（walk 不读它的内容，但存在性要 stat）
  fs.mkdirSync(path.join(dir, 'node_modules', 'ghost-pkg'), { recursive: true });

  // 三条验证路径全覆盖，并留一条不满足项（deltaFour 全仓无）→ 退出码非零
  write(
    dir,
    'spec.md',
    [
      '# Fixture Spec',
      '',
      '## Baseline',
      '- `package.json` 文件存在',
      '- `package.json` 文件存在（再确认）',
      '- 依赖 `left-pad` 已安装',
      '- 依赖 `right-pad` 已安装',
      '- `alphaOne` 与 `betaTwo` 已实现',
      '- `gammaThree` 与 `deltaFour` 已完成',
      '- `epsilonFive` 与 `zetaSix` implemented',
      '',
      '## Details',
      '- 不该被提取',
    ].join('\n')
  );
  // N×K 缩放对照：同样的取数口径，前置条件 2 条 / 关键词 1 个
  write(
    dir,
    'spec-small.md',
    ['# Small', '## Baseline', '- 依赖 `left-pad` 已安装', '- `alphaOne` 已实现'].join('\n')
  );
  // ...与前置条件 7 条 / 关键词 15 个（含三个全仓不存在的）
  write(
    dir,
    'spec-big.md',
    [
      '# Big',
      '## Baseline',
      '- 依赖 `left-pad` 已安装',
      '- 依赖 `right-pad` 已安装',
      '- `alphaOne` 与 `betaTwo` 与 `gammaThree` 已实现',
      '- `zetaSix` 与 `epsilonFive` 与 `deltaFour` 已完成',
      '- `alphaOne` 与 `betaTwo` 与 `zetaSix` implemented',
      '- `gammaThree` 与 `epsilonFive` 与 `missingOne` 已存在',
      '- `deltaFour` 与 `missingTwo` 与 `missingThree` 已实现',
    ].join('\n')
  );
  return dir;
}

describe('一次 spec-baseline-check 的读取计数闸（#146）', () => {
  let io: CapturingIO;
  let dir: string;

  /** 相对项目根的**文件**名 → 内容读取次数（readFileSync 与只读 open 各算一次） */
  function contentCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const call of reads()) {
      if (call.via === 'readdir' || call.via === 'exists') continue;
      const rel = path.relative(dir, call.file);
      if (!rel || rel.startsWith('..')) continue; // 非本项目文件（模块加载等）不计
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
    }
    return counts;
  }

  /** 相对项目根的路径 → 存在性探测次数 */
  function statCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const call of reads()) {
      if (call.via !== 'exists') continue;
      const rel = path.relative(dir, call.file);
      if (!rel || rel.startsWith('..')) continue;
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
    }
    return counts;
  }

  /** 相对项目根的目录名 → readdirSync 次数（全仓扫描遍历过的目录） */
  function dirCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const call of dirs()) {
      const rel = path.relative(dir, call);
      if (!rel) {
        counts.set('.', (counts.get('.') ?? 0) + 1);
      } else if (!rel.startsWith('..')) {
        counts.set(rel, (counts.get(rel) ?? 0) + 1);
      }
    }
    return counts;
  }

  function reset(): void {
    // 原地清空：mock 工厂在装载时就 captured 了这些引用，换新数组计数会落到旧的去向（假绿）
    reads().length = 0;
    dirs().length = 0;
  }

  beforeEach(() => {
    reset();
    io = captureIO();
    dir = fixtureProject();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('整张读取表如实冻结：本次运行读了哪些项目文件、各读几次', async () => {
    const result = await specBaselineCheck(path.join(dir, 'spec.md'), { json: true, projectPath: dir }, io);
    expect(result.kind).toBe('fail');

    // 正对照：三条验证路径都真评估了（否则下面的表是空跑）
    const results = JSON.parse(io.outText()) as Array<{ prerequisite: string; evidence: string }>;
    const evidence = results.map((r) => r.evidence).join('\n');
    expect(evidence).toContain('文件存在: package.json');
    expect(evidence).toContain('依赖已安装: left-pad');
    expect(evidence).toContain('代码中找到: alphaOne (2 files), betaTwo (1 files)');
    expect(evidence).toContain('找到: gammaThree (1 files); 未找到: deltaFour');

    expect([...contentCounts().entries()].sort()).toEqual(
      [
        // —— 一次运行一份：本票的承诺面 ——
        ['package.json', 1], // 两条依赖前置共用同一份解析（改前 = 2）
        ['spec.md', 1], // 命令入口读 spec 本身
        ['src/a.ts', 1],
        ['src/b.ts', 1],
        ['src/c.ts', 1],
        ['src/d.ts', 1],
        ['src/nested/e.ts', 1],
        ['tools.js', 1], // 表上无 dist/、node_modules/、.harness/ 条目 = 跳过口径未变
      ].sort()
    );

    // 同一落点的存在性探测：两条前置问 `package.json` 是否在世，只 stat 一次（改前 = 2）
    expect([...statCounts().entries()].sort()).toEqual(
      [
        ['package.json', 1],
        ['spec.md', 1],
      ].sort()
    );

    // 全仓 walk 只发生一遍（3 个目录各列举一次）
    expect([...dirCounts().entries()].sort()).toEqual(
      [['.', 1], ['src', 1], [path.join('src', 'nested'), 1]].sort()
    );
  });

  it('除上表点名条目外，项目文件一次运行内一律至多读一次', async () => {
    await specBaselineCheck(path.join(dir, 'spec.md'), { json: true, projectPath: dir }, io);

    const offenders = [...contentCounts()].filter(([, n]) => n > 1);
    expect(offenders).toEqual([]);
  });

  it('读取次数与前置条件条数、关键词数无关（N×K → 常数）', async () => {
    await specBaselineCheck(path.join(dir, 'spec-small.md'), { json: true, projectPath: dir }, io);
    const small = new Map(contentCounts());
    const smallDirs = [...dirCounts().entries()].sort();
    const smallReadTotal = small.get('spec-small.md');

    // 正对照：big 的前置条件确实更多（2 条 vs 7 条、关键词 1 个 vs 15 个）
    expect((JSON.parse(io.outText()) as unknown[]).length).toBe(2);
    const ioBig = captureIO();
    reset();
    await specBaselineCheck(path.join(dir, 'spec-big.md'), { json: true, projectPath: dir }, ioBig);
    const big = new Map(contentCounts());
    const bigDirs = [...dirCounts().entries()].sort();
    expect((JSON.parse(ioBig.outText()) as unknown[]).length).toBe(7);

    // 同一份数据的同一口径：把 spec 自身那次读取剔掉后，两张表逐条相同
    small.delete('spec-small.md');
    big.delete('spec-big.md');
    expect([...big.entries()].sort()).toEqual([...small.entries()].sort());
    expect(smallReadTotal).toBe(1);

    // 扫描口径同样与条数无关：15 个关键词仍在同一遍 walk 上重放
    expect(bigDirs).toEqual(smallDirs);
    expect(big.get('package.json')).toBe(1);
  });

  it('package.json 读取失败态同样入库：两条依赖前置只尝试读一次', async () => {
    fs.rmSync(path.join(dir, 'package.json'));

    await specBaselineCheck(path.join(dir, 'spec.md'), { json: true, projectPath: dir }, io);

    // 判定照旧：读不到就是「无法读取 package.json」，每条前置各报一次
    const results = JSON.parse(io.outText()) as Array<{ satisfied: boolean; evidence: string }>;
    const failures = results.filter((r) => r.evidence === '无法读取 package.json');
    expect(failures).toHaveLength(2);
    expect(failures.every((r) => !r.satisfied)).toBe(true);

    // 但失败的那次尝试只发生一遍（改前 = 2）
    expect(contentCounts().get('package.json')).toBe(1);
  });

  it('只走依赖路径的前置不触发全仓扫描，node_modules 兜底照旧生效', async () => {
    write(
      dir,
      'spec-dep-only.md',
      ['# Deps Only', '## Baseline', '- 依赖 `ghost-pkg` 与 `nowhere-pkg` 已安装'].join('\n')
    );
    reset();

    const result = await specBaselineCheck(
      path.join(dir, 'spec-dep-only.md'),
      { json: true, projectPath: dir },
      io
    );

    // 判定照旧：一个活在 node_modules 里、一个两处都无 → 部分存在
    expect(result.kind).toBe('fail');
    expect(JSON.parse(io.outText())[0].evidence).toBe('已安装: ghost-pkg; 缺失: nowhere-pkg');

    // 懒建：没有任何前置要读源码内容，全仓一次都没扫（改前也是 0，此条守的是「别把它改成 eager」）
    expect([...contentCounts().entries()].sort()).toEqual(
      [
        ['package.json', 1],
        ['spec-dep-only.md', 1],
      ].sort()
    );
    expect(dirCounts().size).toBe(0);
    // 兜底的存在性探测确实发生，且同一落点只 stat 一次
    expect([...statCounts().entries()].sort()).toEqual(
      [
        [path.join('node_modules', 'ghost-pkg'), 1],
        [path.join('node_modules', 'nowhere-pkg'), 1],
        ['spec-dep-only.md', 1],
      ].sort()
    );
  });
});
