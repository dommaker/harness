/**
 * tail 倒读路径的「不整读全文」闸（ADR-0023 决策 3）
 *
 * 单独成文件的理由：Node 的 `fs` 导出属性不可 redefine，`jest.spyOn(fs, 'readFileSync')`
 * 直接抛 `Cannot redefine property`——只能在模块解析层把 `readFileSync` 换成必炸实现，
 * 其余 fs 行为经 requireActual 保真（倒读用的 openSync/fstatSync/readSync 都是真的）。
 *
 * 反向断言（全文读必须炸）是这道闸的自我检查：没有它，「tail 通过」可能只是 mock 没生效。
 */

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: () => {
    throw new Error('整读全文：tail 消费方不该走到这条路径');
  },
}));

import * as path from 'path';
import { readJsonl } from '../jsonl';

interface Row {
  n: number;
}

const realFs = jest.requireActual('fs');
const realOs = jest.requireActual('os');

describe('readJsonl tail 倒读', () => {
  let dir: string;
  let filePath: string;

  beforeAll(() => {
    dir = realFs.mkdtempSync(path.join(realOs.tmpdir(), 'harness-tail-seek-'));
    // 20 万行 ≈ 4MB，远超 64KB 分块：整读要把它全捞进内存，倒读只需捞尾部若干块
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

  it('tail 大于总行数时仍不整读，取全部非空行', () => {
    const small = path.join(dir, 'small.jsonl');
    realFs.writeFileSync(small, '{"n":1}\n{"n":2}\n', 'utf-8');
    expect(readJsonl<Row>(small, 'throw', { tail: 50 }).records.map(r => r.n)).toEqual([1, 2]);
  });
});
