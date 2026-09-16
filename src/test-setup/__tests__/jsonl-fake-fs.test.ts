/**
 * 有界读 fs 假件测试（ADR-0023 决策 3 的夹具层）
 *
 * 钉的是夹具的契约：它给出的字节视图必须与 `readFile(path)` 的字符串**逐项等价**、且
 * **跟着 openSync 的路径走**。两条读入口一旦各演一份世界，被测代码的容错分支会把不一致
 * 吞成假象（本夹具存在的理由就是消灭这类假象）。
 */

import { jsonlBoundedReadChain } from '../jsonl-fake-fs';

describe('jsonlBoundedReadChain', () => {
  it('fstatSync 的 size 是所开文件的 UTF-8 字节数，不是字符数', () => {
    const text = '{"n":1,"文本":"约束"}\n';
    const chain = jsonlBoundedReadChain(() => text);
    const fd = chain.openSync('/x/a.jsonl', 'r');
    expect(chain.fstatSync(fd).size).toBe(Buffer.byteLength(text, 'utf-8'));
    expect(chain.fstatSync(fd).size).toBeGreaterThan(text.length);
  });

  it('readSync 按 position/length 取窗口并回填缓冲，返回实际读到的字节数', () => {
    const chain = jsonlBoundedReadChain(() => 'abcdef\nghijkl\n');
    const fd = chain.openSync('/x/a.jsonl');
    const buf = Buffer.alloc(7);
    expect(chain.readSync(fd, buf, 0, 7, 7)).toBe(7);
    expect(buf.toString('utf-8')).toBe('ghijkl\n');
  });

  it('越界的 length 只拷到文件末尾，超出 EOF 读到 0 字节', () => {
    const chain = jsonlBoundedReadChain(() => 'ab\n');
    const fd = chain.openSync('/x/a.jsonl');
    const tail = Buffer.alloc(4);
    expect(chain.readSync(fd, tail, 0, 4, 1)).toBe(2);
    expect(tail.subarray(0, 2).toString('utf-8')).toBe('b\n');
    expect(chain.readSync(fd, Buffer.alloc(2), 0, 2, 99)).toBe(0);
  });

  it('offset 让调用方把多块拼进同一缓冲（分块读的形状）', () => {
    const chain = jsonlBoundedReadChain(() => '0123456789');
    const fd = chain.openSync('/x/a.jsonl');
    const buf = Buffer.alloc(6);
    chain.readSync(fd, buf, 0, 4, 0);
    chain.readSync(fd, buf, 4, 2, 4);
    expect(buf.toString('utf-8')).toBe('012345');
  });

  it('按路径分派内容：同一次运行开两个文件，各自读到自己的那份', () => {
    const files: Record<string, string> = {
      '/s/1/checkpoint.json': '{"id":"cp-1"}\n',
      '/s/1/events.jsonl': '{"type":"user_message"}\n{"type":"assistant_message"}\n',
    };
    const chain = jsonlBoundedReadChain(p => files[p] ?? '');
    const fdA = chain.openSync('/s/1/checkpoint.json');
    const fdB = chain.openSync('/s/1/events.jsonl');
    expect(chain.fstatSync(fdA).size).toBe(Buffer.byteLength(files['/s/1/checkpoint.json']));
    expect(chain.fstatSync(fdB).size).toBe(Buffer.byteLength(files['/s/1/events.jsonl']));
    const buf = Buffer.alloc(64);
    const n = chain.readSync(fdB, buf, 0, 64, 0);
    expect(buf.subarray(0, n).toString('utf-8')).toBe(files['/s/1/events.jsonl']);
  });

  it('未开过的 fd 与 close 掉的 fd 都按空文件处理，不互相串内容', () => {
    // 内容源必须按路径分派：不看路径的源会让「路径丢失」这条失效模式测不出来
    const files: Record<string, string> = { '/x/a.jsonl': 'x\ny\n' };
    const chain = jsonlBoundedReadChain(p => files[p] ?? '');
    const fd = chain.openSync('/x/a.jsonl');
    expect(chain.fstatSync(fd).size).toBe(4);
    chain.closeSync(fd);
    expect(chain.fstatSync(fd).size).toBe(0);
    expect(chain.fstatSync(999).size).toBe(0);
  });

  it('内容每次现取：改了 readFile 的返回，下一次读立即看到', () => {
    let value = 'first\n';
    const chain = jsonlBoundedReadChain(() => value);
    const fd = chain.openSync('/x/a.jsonl');
    expect(chain.fstatSync(fd).size).toBe(6);
    value = 'second-longer\n';
    expect(chain.fstatSync(fd).size).toBe(14);
    const buf = Buffer.alloc(14);
    chain.readSync(fd, buf, 0, 14, 0);
    expect(buf.toString('utf-8')).toBe('second-longer\n');
  });

  it('非字符串内容按空文件处理（mock 未设置返回值时的缺省形状）', () => {
    for (const raw of [undefined, null, 0]) {
      const chain = jsonlBoundedReadChain(() => raw);
      const fd = chain.openSync('/x/a.jsonl');
      expect(chain.fstatSync(fd).size).toBe(0);
      expect(chain.readSync(fd, Buffer.alloc(3), 0, 3, 0)).toBe(0);
    }
  });

  it('openSync 每次发新 fd，多次开关不冲突', () => {
    const chain = jsonlBoundedReadChain(() => 'a\n');
    const fds = [chain.openSync('/x/a.jsonl'), chain.openSync('/x/a.jsonl')];
    expect(new Set(fds).size).toBe(2);
  });
});
