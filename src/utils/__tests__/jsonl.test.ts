/**
 * JSONL 读写正本测试（harness#82）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonl, readJsonlEnds, appendJsonl } from '../jsonl';

interface Row {
  n: number;
}

const CORRUPT = '{"n":2,"broken';

describe('readJsonl', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, lines: string[]): string {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    return filePath;
  }

  it('按文件顺序解析全部合法行', () => {
    const filePath = write('ok.jsonl', ['{"n":1}', '{"n":2}', '{"n":3}']);
    const { records, skippedLines } = readJsonl<Row>(filePath, 'skip');
    expect(records.map(r => r.n)).toEqual([1, 2, 3]);
    expect(skippedLines).toBe(0);
  });

  it('缺文件返回空结果，不抛', () => {
    expect(readJsonl<Row>(path.join(dir, 'missing.jsonl'), 'skip')).toEqual({
      records: [],
      skippedLines: 0,
    });
  });

  it('空文件与纯空白行返回空结果', () => {
    const empty = write('empty.jsonl', []);
    const blank = write('blank.jsonl', ['', '   ', '\t']);
    expect(readJsonl<Row>(empty, 'skip').records).toEqual([]);
    expect(readJsonl<Row>(blank, 'skip').records).toEqual([]);
  });

  it("policy 'skip'：坏行计数、合法行照常返回", () => {
    const filePath = write('dirty.jsonl', ['{"n":1}', CORRUPT, '', '{"n":3}']);
    const { records, skippedLines } = readJsonl<Row>(filePath, 'skip');
    expect(records.map(r => r.n)).toEqual([1, 3]);
    expect(skippedLines).toBe(1);
  });

  it("policy 'throw'：坏行上抛", () => {
    const filePath = write('dirty.jsonl', ['{"n":1}', CORRUPT]);
    expect(() => readJsonl<Row>(filePath, 'throw')).toThrow(SyntaxError);
  });

  it('读入口无策略缺省值：不传 policy 编译期即失败（裁决 1，@ts-expect-error 固定）', () => {
    // @ts-expect-error policy 为显式必填参数，缺省必须在编译期失败
    const result = readJsonl<Row>(path.join(dir, 'unused.jsonl'));
    expect(result.records).toEqual([]);
  });

  it('tail：只解析最后 N 个非空行', () => {
    const filePath = write('tail.jsonl', ['{"n":1}', '{"n":2}', CORRUPT, '{"n":4}']);
    const { records, skippedLines } = readJsonl<Row>(filePath, 'skip', { tail: 2 });
    expect(records.map(r => r.n)).toEqual([4]);
    expect(skippedLines).toBe(1);
  });

  it('head：只解析前 N 个非空行', () => {
    const filePath = write('head.jsonl', ['{"n":1}', CORRUPT, '{"n":3}', '{"n":4}']);
    const { records, skippedLines } = readJsonl<Row>(filePath, 'skip', { head: 2 });
    expect(records.map(r => r.n)).toEqual([1]);
    expect(skippedLines).toBe(1);
  });

  it('tail/head 超过总行数时取全部', () => {
    const filePath = write('small.jsonl', ['{"n":1}']);
    expect(readJsonl<Row>(filePath, 'skip', { tail: 10 }).records).toHaveLength(1);
    expect(readJsonl<Row>(filePath, 'skip', { head: 10 }).records).toHaveLength(1);
  });

  // ===== tail 倒读（ADR-0023 决策 3）：语义必须与「整读后 slice」逐字一致 =====

  it('tail：与整读后截断的结果逐字等价', () => {
    const filePath = write('equiv.jsonl', ['{"n":1}', CORRUPT, '', '{"n":4}', '  ', '{"n":6}']);
    const whole = readJsonl<Row>(filePath, 'skip');
    const tail = readJsonl<Row>(filePath, 'skip', { tail: 3 });
    // 末尾 3 个非空行含 1 个坏行 → records 只剩 2 条，坏行照旧计入 skippedLines
    expect(tail.records).toEqual(whole.records.slice(-2));
    expect(tail.records.map(r => r.n)).toEqual([4, 6]);
    expect(tail.skippedLines).toBe(1);
  });

  it('tail：跨 64KB 块边界的多字节字符不被切断', () => {
    // 每行含 CJK，行数足够跨过若干个分块边界；残段按字节留到下一轮才解码
    const lines = Array.from(
      { length: 1200 },
      (_, i) => JSON.stringify({ n: i, 文本: '约束进化飞轮'.repeat(12) })
    );
    const filePath = write('wide.jsonl', lines);
    expect(fs.statSync(filePath).size).toBeGreaterThan(64 * 1024);
    const { records, skippedLines } = readJsonl<{ n: number; 文本: string }>(
      filePath,
      'throw',
      { tail: 5 }
    );
    expect(skippedLines).toBe(0);
    expect(records.map(r => r.n)).toEqual([1195, 1196, 1197, 1198, 1199]);
    expect(records[0].文本).toBe('约束进化飞轮'.repeat(12));
  });

  it('tail：末行无换行也能取到', () => {
    const filePath = path.join(dir, 'no-eol.jsonl');
    fs.writeFileSync(filePath, '{"n":1}\n{"n":2}', 'utf-8');
    expect(readJsonl<Row>(filePath, 'skip', { tail: 1 }).records.map(r => r.n)).toEqual([2]);
  });

  it('tail：CRLF 的 \\r 随行进文本，parse 照旧通过', () => {
    const filePath = path.join(dir, 'crlf.jsonl');
    fs.writeFileSync(filePath, '{"n":1}\r\n{"n":2}\r\n', 'utf-8');
    expect(readJsonl<Row>(filePath, 'throw', { tail: 2 }).records.map(r => r.n)).toEqual([1, 2]);
  });

  it('tail：文件尾部的纯空白行不计数，继续往前找够数', () => {
    const filePath = write('blank-tail.jsonl', ['{"n":1}', '{"n":2}', '', '   ', '\t']);
    expect(readJsonl<Row>(filePath, 'skip', { tail: 2 }).records.map(r => r.n)).toEqual([1, 2]);
  });

  it('tail：走倒读分块，不整读全文——见 jsonl-tail-seek.test.ts（fs 导出属性不可 redefine，只能在模块层 mock）', () => {
    const filePath = write('seek.jsonl', Array.from({ length: 5000 }, (_, i) => `{"n":${i}}`));
    expect(readJsonl<Row>(filePath, 'skip', { tail: 2 }).records.map(r => r.n)).toEqual([
      4998, 4999,
    ]);
  });

  it('tail: 0 与缺文件均返回空结果，不打开文件', () => {
    const filePath = write('zero.jsonl', ['{"n":1}']);
    expect(readJsonl<Row>(filePath, 'skip', { tail: 0 })).toEqual({
      records: [],
      skippedLines: 0,
    });
    expect(readJsonl<Row>(path.join(dir, 'missing.jsonl'), 'skip', { tail: 5 })).toEqual({
      records: [],
      skippedLines: 0,
    });
  });
});

describe('readJsonlEnds', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, lines: string[]): string {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    return filePath;
  }

  it('取首/末条合法记录 + 原始行数（含坏行）', () => {
    const filePath = write('ends.jsonl', ['{"n":1}', CORRUPT, '{"n":3}']);
    expect(readJsonlEnds<Row>(filePath, 'skip')).toEqual({
      totalLines: 3,
      first: { n: 1 },
      last: { n: 3 },
    });
  });

  it('首/末行坏时跳过坏行取最近的合法记录', () => {
    const filePath = write('dirty-ends.jsonl', [CORRUPT, '{"n":2}', '{"n":3}', CORRUPT]);
    const result = readJsonlEnds<Row>(filePath, 'skip');
    expect(result.first).toEqual({ n: 2 });
    expect(result.last).toEqual({ n: 3 });
    expect(result.totalLines).toBe(4);
  });

  it("policy 'throw'：首端遇坏行上抛", () => {
    const filePath = write('throw.jsonl', [CORRUPT, '{"n":2}']);
    expect(() => readJsonlEnds<Row>(filePath, 'throw')).toThrow();
  });

  it('缺文件 / 全坏行返回无首末记录', () => {
    expect(readJsonlEnds<Row>(path.join(dir, 'missing.jsonl'), 'skip')).toEqual({ totalLines: 0 });

    const filePath = write('all-bad.jsonl', [CORRUPT, CORRUPT]);
    expect(readJsonlEnds<Row>(filePath, 'skip')).toEqual({ totalLines: 2 });
  });
});

describe('appendJsonl', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('目录不存在时递归创建并追加单行 JSON', () => {
    const filePath = path.join(dir, 'a', 'b', 'log.jsonl');
    appendJsonl(filePath, { n: 1 });
    appendJsonl(filePath, { n: 2 });

    expect(readJsonl<Row>(filePath, 'skip').records.map(r => r.n)).toEqual([1, 2]);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    expect(lines[0]).toBe('{"n":1}');
    expect(lines[1]).toBe('{"n":2}');
    expect(lines[2]).toBe('');
  });

  it('与 readJsonl 构成读写闭环', () => {
    const filePath = path.join(dir, 'roundtrip.jsonl');
    appendJsonl(filePath, { n: 7 });
    expect(readJsonl<Row>(filePath, 'skip').records).toEqual([{ n: 7 }]);
  });
});
