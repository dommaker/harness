/**
 * JSONL 读写正本测试（harness#82）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJsonl, countJsonlLines, appendJsonl } from '../jsonl';

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
});

describe('countJsonlLines', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-jsonl-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('计非空行数（含坏行），缺文件为 0', () => {
    const filePath = path.join(dir, 'c.jsonl');
    fs.writeFileSync(filePath, ['{"n":1}', CORRUPT, '', '  '].join('\n') + '\n', 'utf-8');
    expect(countJsonlLines(filePath)).toBe(2);
    expect(countJsonlLines(path.join(dir, 'missing.jsonl'))).toBe(0);
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

    expect(countJsonlLines(filePath)).toBe(2);
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
