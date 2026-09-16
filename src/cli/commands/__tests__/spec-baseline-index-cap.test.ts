/**
 * spec-baseline-check 共享索引的驻留上界闸（#162，统一复审遗留项 3）
 *
 * #146 把 `sourceContents()` 改成全仓内容常驻一个 Map：排除面只有
 * node_modules / dist / 隐藏目录与 .ts/.js 后缀，**无单文件字节、总量、条目上限**——
 * 峰值内存由 O(单文件) 变 O(全仓源码)，studio 级 monorepo 跑本命令会承担这个峰值，
 * 而本仓 146 个源文件的规模测不出来。
 *
 * 裁决（票面修法二）：索引加总量上限（条目数 + 字节数双闸），超限即放弃驻留、
 * 回落逐文件流式读——峰值回到 O(单文件)，正常规模仓保留「一次遍历」收益。
 *
 * 可观测判据 = 驻留与否的读取行为差：上限内每份源文件一次运行只读一遍
 * （任意关键词重放不重读）；超限后每个关键词都重新流式读一遍（证明没有偷偷驻留）。
 *
 * 反证（各改坏一次即红）：
 * - 摘掉上限常量 `SOURCE_INDEX_MAX_ENTRIES` / `SOURCE_INDEX_MAX_BYTES`
 *   → 缺省形参失去引用，tsc 直接红；
 * - 删掉超限回落分支（超限也照常驻留）
 *   → 「超条目/字节上限」两例的「每关键词重读一遍」断言转红。
 */

import { describe, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// 计件挂 globalThis，形状照 `spec-baseline-read-count.test.ts`：
// jest.mock 工厂会被提前调用，闭包外提会撞 TDZ
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as { __SBC162_READS__?: string[] };
  if (!g.__SBC162_READS__) g.__SBC162_READS__ = [];
  const bucket = g.__SBC162_READS__;
  return {
    ...actual,
    readFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push(Buffer.isBuffer(p) ? p.toString('utf8') : String(p));
      return (actual.readFileSync as (...args: unknown[]) => unknown)(p, ...rest);
    }),
  };
});

import {
  createBaselineIndex,
  SOURCE_INDEX_MAX_ENTRIES,
  SOURCE_INDEX_MAX_BYTES,
} from '../spec-baseline-check';

const reads = () =>
  ((globalThis as unknown as { __SBC162_READS__?: string[] }).__SBC162_READS__ ||= []);

function write(dir: string, rel: string, content: string): void {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
}

/** 4 份源文件：needleA 命中 2 份、needleB 命中 1 份、miss 命中 0 份 */
function fixtureProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbc-index-cap-'));
  write(dir, 'src/a.ts', 'export const a = "needleA";\n');
  write(dir, 'src/b.ts', 'export const b = "needleA needleB";\n');
  write(dir, 'src/c.ts', 'export const c = "plain";\n');
  write(dir, 'tools.js', 'module.exports = "plain";\n');
  return dir;
}

/** dir 内 .ts/.js 源文件被 readFileSync 读到的总次数 */
function sourceReadCount(dir: string): number {
  return reads().filter((file) => {
    const rel = path.relative(dir, file);
    return rel && !rel.startsWith('..') && (rel.endsWith('.ts') || rel.endsWith('.js'));
  }).length;
}

describe('spec-baseline-check 共享索引的驻留上界（#162）', () => {
  let dir: string;

  beforeEach(() => {
    // 原地清空：mock 工厂在装载时就 captured 了引用，换新数组计数会落到旧的去向（假绿）
    reads().length = 0;
    dir = fixtureProject();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('上限常量存在且为正数（摘掉常量 → tsc 红；归零 → 下两例的口径全变）', () => {
    expect(SOURCE_INDEX_MAX_ENTRIES).toBeGreaterThan(0);
    expect(SOURCE_INDEX_MAX_BYTES).toBeGreaterThan(0);
  });

  it('上限内：驻留索引重放——每份源文件一次运行只读一遍，任意关键词不触发重读', () => {
    const index = createBaselineIndex(dir);

    expect(index.countFilesContaining('needleA')).toBe(2);
    expect(index.countFilesContaining('needleB')).toBe(1);
    expect(index.countFilesContaining('miss')).toBe(0);
    // 三个关键词跑完，4 份源文件总共只读了 4 次（驻留重放，改前逐关键词重读 = 12）
    expect(sourceReadCount(dir)).toBe(4);
  });

  it('超条目上限：放弃驻留、回落逐文件流式读——每个关键词重读一遍，判定不变', () => {
    const index = createBaselineIndex(dir, {
      maxEntries: 2, // 夹具 4 份源文件 > 2
      maxBytes: SOURCE_INDEX_MAX_BYTES,
    });

    expect(index.countFilesContaining('needleA')).toBe(2);
    const afterFirst = sourceReadCount(dir);
    // 首个关键词额外付一次「建到上限即弃」的中止尝试（读取 ≤ 上限 + 1 份）+ 一遍流式全扫
    expect(afterFirst).toBeLessThanOrEqual(2 + 1 + 4);

    expect(index.countFilesContaining('needleB')).toBe(1);
    // 无驻留的证据：第二个关键词仍重新流式读完全仓（驻留着此处增量 = 0）
    expect(sourceReadCount(dir) - afterFirst).toBe(4);
  });

  it('超字节上限：同样回落流式读', () => {
    const index = createBaselineIndex(dir, {
      maxEntries: SOURCE_INDEX_MAX_ENTRIES,
      maxBytes: 10, // 任意一份文件就超过
    });

    expect(index.countFilesContaining('needleA')).toBe(2);
    const afterFirst = sourceReadCount(dir);
    expect(index.countFilesContaining('miss')).toBe(0);
    expect(sourceReadCount(dir) - afterFirst).toBe(4);
  });
});
