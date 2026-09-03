/**
 * 命令契约测试（架构评审候选7）
 *
 * Seam：src/cli/command-contract.ts —— 命令实现的返回形状 + 输出注入面。
 * 关键不变量：注入缺省 io（process 流）时，log/logError 的输出字节与
 * console.log/console.error 逐字一致（CLI 语法冻结护栏：输出文案不得漂移）。
 */

import { Writable } from 'stream';
import {
  captureIO,
  log,
  logError,
  processIO,
  type CommandIO,
  type CommandResult,
} from '../command-contract';

/** 同步收集写入 chunk 的最小可写流（console.Console 与 CommandIO 共用同一 sink） */
class Sink extends Writable {
  private chunks: string[] = [];
  _write(chunk: any, _enc: string, cb: () => void): void {
    this.chunks.push(String(chunk));
    cb();
  }
  reset(): void {
    this.chunks = [];
  }
  get text(): string {
    return this.chunks.join('');
  }
}

/**
 * 同一参数分别经 Node 的 console（标准实现）与 log/logError（命令侧写入面）
 * 写入同一 sink，返回两者渲染文本。
 */
function renderBoth(method: 'log' | 'error', args: unknown[]): { viaConsole: string; viaContract: string } {
  const out = new Sink();
  const err = new Sink();
  const io: CommandIO = { stdout: out, stderr: err };

  const nodeConsole = new console.Console(out, err);
  (nodeConsole[method] as (...a: unknown[]) => void)(...args);
  const viaConsole = method === 'log' ? out.text : err.text;

  out.reset();
  err.reset();
  if (method === 'log') log(io, ...args);
  else logError(io, ...args);
  const viaContract = method === 'log' ? out.text : err.text;

  return { viaConsole, viaContract };
}

describe('log/logError 与 console 输出等价', () => {
  const cases: unknown[][] = [
    [],
    ['plain'],
    ['%s and %d and %j', 'x', 3, { a: 1 }],
    [{ nested: { deep: [1, 2, 3] } }],
    [null, undefined, 0, false],
    ['多字节 ✓ emoji 🎉'],
    [''],
  ];

  it.each(cases.map((c, i) => [i, c] as [number, unknown[]]))(
    'case %i：log(io) 与 console.log 逐字节一致',
    (_i, args) => {
      const { viaConsole, viaContract } = renderBoth('log', args as unknown[]);
      expect(viaContract).toBe(viaConsole);
    },
  );

  it.each(cases.map((c, i) => [i, c] as [number, unknown[]]))(
    'case %i：logError(io) 与 console.error 逐字节一致',
    (_i, args) => {
      const { viaConsole, viaContract } = renderBoth('error', args as unknown[]);
      expect(viaContract).toBe(viaConsole);
    },
  );

  it('缺省 io 指向 process 标准流', () => {
    expect(processIO.stdout).toBe(process.stdout);
    expect(processIO.stderr).toBe(process.stderr);
  });
});

describe('captureIO（测试注入面）', () => {
  it('stdout/stderr 分别累积，按行可取', () => {
    const io = captureIO();
    log(io, 'one');
    log(io, 'two %s', 'x');
    logError(io, 'boom');
    expect(io.outLines()).toEqual(['one', 'two x']);
    expect(io.errLines()).toEqual(['boom']);
    expect(io.outText()).toBe('one\ntwo x\n');
    expect(io.errText()).toBe('boom\n');
  });

  it('无参 log 产生空行（console.log() 语义）', () => {
    const io = captureIO();
    log(io);
    expect(io.outText()).toBe('\n');
    expect(io.outLines()).toEqual(['']);
  });

  it('outRecords/errRecords 保留每次写入原文（多行 JSON 等同一次打印的整体）', () => {
    const io = captureIO();
    log(io, JSON.stringify({ a: 1 }, null, 2));
    logError(io, 'e1');
    logError(io, 'e2');

    expect(io.outRecords()).toHaveLength(1);
    expect(JSON.parse(io.outRecords()[0])).toEqual({ a: 1 });
    expect(io.errRecords()).toEqual(['e1\n', 'e2\n']);
  });

  it('同一命令内 stdout 与 stderr 互不串台', () => {
    const io = captureIO();
    log(io, 'a');
    logError(io, 'b');
    log(io, 'c');
    expect(io.outLines()).toEqual(['a', 'c']);
    expect(io.errLines()).toEqual(['b']);
  });
});

describe('CommandResult 判别联合', () => {
  it('四种 kind 均可构造，fail/usage-error 必带 reason（类型层护栏）', () => {
    const results: CommandResult[] = [
      { kind: 'ok' },
      { kind: 'skip', reason: '约定未采纳' },
      { kind: 'skip' },
      { kind: 'fail', reason: 'gate:branch 非 master' },
      { kind: 'usage-error', reason: '缺少 planPath' },
    ];
    const kinds = results.map(r => r.kind);
    expect(kinds).toEqual(['ok', 'skip', 'skip', 'fail', 'usage-error']);
    expect(results.filter(r => r.kind !== 'ok').map(r => ('reason' in r ? r.reason : undefined)))
      .toEqual(['约定未采纳', undefined, 'gate:branch 非 master', '缺少 planPath']);
  });
});
