/**
 * 有界读的「不整读全文」闸（ADR-0023 决策 3：tail 倒读，并同型推广到 head 正读）
 *
 * 单独成文件的理由：Node 的 `fs` 导出属性不可 redefine，`jest.spyOn(fs, 'readFileSync')`
 * 直接抛 `Cannot redefine property`——只能在模块解析层把 `readFileSync` 换成必炸实现，
 * 其余 fs 行为经 requireActual 保真（两条有界读用的 openSync/fstatSync/readSync 都是真的）。
 *
 * 反向断言（全文读必须炸）是这道闸的自我检查：没有它，「有界读通过」可能只是 mock 没生效。
 */

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: () => {
    throw new Error('整读全文：有界读消费方不该走到这条路径');
  },
}));

import * as path from 'path';
import { readJsonl } from '../jsonl';

interface Row {
  n: number;
}

const realFs = jest.requireActual('fs');
const realOs = jest.requireActual('os');

describe('readJsonl 有界读', () => {
  let dir: string;
  let filePath: string;

  beforeAll(() => {
    dir = realFs.mkdtempSync(path.join(realOs.tmpdir(), 'harness-bounded-read-'));
    // 20 万行 ≈ 4MB，远超 64KB 分块：整读要把它全捞进内存，有界读只需捞一端
    const lines = Array.from({ length: 200000 }, (_, i) => `{"n":${i}}`);
    filePath = path.join(dir, 'big.jsonl');
    realFs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  });

  afterAll(() => {
    realFs.rmSync(dir, { recursive: true, force: true });
  });

  it('mock 生效：全文读确实走 readFileSync（必炸）', () => {
    expect(() => readJsonl<Row>(filePath, 'skip')).toThrow('整读全文');
  });

  it('tail 只要够数的尾部行，不整读全文', () => {
    const { records, skippedLines } = readJsonl<Row>(filePath, 'throw', { tail: 3 });
    expect(skippedLines).toBe(0);
    expect(records.map(r => r.n)).toEqual([199997, 199998, 199999]);
  });

  it('head 只要够数的头部行，不整读全文', () => {
    const { records, skippedLines } = readJsonl<Row>(filePath, 'throw', { head: 3 });
    expect(skippedLines).toBe(0);
    expect(records.map(r => r.n)).toEqual([0, 1, 2]);
  });

  it('head：跨 64KB 块边界的多字节字符不被切断', () => {
    const wide = path.join(dir, 'wide.jsonl');
    const lines = Array.from(
      { length: 1200 },
      (_, i) => JSON.stringify({ n: i, 文本: '约束进化飞轮'.repeat(12) })
    );
    realFs.writeFileSync(wide, lines.join('\n') + '\n', 'utf-8');
    expect(realFs.statSync(wide).size).toBeGreaterThan(64 * 1024);
    const { records, skippedLines } = readJsonl<{ n: number; 文本: string }>(wide, 'throw', {
      head: 2,
    });
    expect(skippedLines).toBe(0);
    expect(records.map(r => r.n)).toEqual([0, 1]);
    expect(records[1].文本).toBe('约束进化飞轮'.repeat(12));
  });

  it('两端超过总行数时取全部', () => {
    const small = path.join(dir, 'small.jsonl');
    realFs.writeFileSync(small, '{"n":1}\n{"n":2}\n', 'utf-8');
    expect(readJsonl<Row>(small, 'throw', { tail: 50 }).records.map(r => r.n)).toEqual([1, 2]);
    expect(readJsonl<Row>(small, 'throw', { head: 50 }).records.map(r => r.n)).toEqual([1, 2]);
  });

  it('head: 0 与缺文件返回空结果，不打开文件', () => {
    const few = path.join(dir, 'few.jsonl');
    realFs.writeFileSync(few, '{"n":1}\n', 'utf-8');
    expect(readJsonl<Row>(few, 'skip', { head: 0 })).toEqual({ records: [], skippedLines: 0 });
    expect(readJsonl<Row>(path.join(dir, 'missing.jsonl'), 'skip', { head: 5 })).toEqual({
      records: [],
      skippedLines: 0,
    });
  });

  it('head 的槽位口径与整读一致：坏行占一个尾部槽位、不进 records', () => {
    const dirty = path.join(dir, 'dirty.jsonl');
    realFs.writeFileSync(dirty, 'not-json\n{"n":2}\n{"n":3}\n', 'utf-8');
    const { records, skippedLines } = readJsonl<Row>(dirty, 'skip', { head: 2 });
    expect(skippedLines).toBe(1);
    expect(records.map(r => r.n)).toEqual([2]);
  });

  it('末行无换行时 head 也能取到它', () => {
    const noEol = path.join(dir, 'no-eol.jsonl');
    realFs.writeFileSync(noEol, '{"n":1}\n{"n":2}', 'utf-8');
    expect(readJsonl<Row>(noEol, 'throw', { head: 2 }).records.map(r => r.n)).toEqual([1, 2]);
  });
});
