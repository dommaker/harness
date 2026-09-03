/**
 * CLI 命令契约（架构评审候选7）
 *
 * 命令实现的 interface 由两部分组成，都在本模块定义：
 * - **返回值 `CommandResult`**：判定结果（哪个 kind、为什么）。退出码不再由命令
 *   自己 `process.exit`，而是由 bin 依 kind 唯一映射（`process.exit` 因此只出现在
 *   bin/harness.js 一处）。
 * - **写入面 `CommandIO`**：流式输出去向。命令一律经注入的 io 打印，缺省 process
 *   标准流——长命令（如 release）边跑边输出，不憋到结束由 bin 统一打印。
 *
 * 对外行为护栏：`processIO` 下 log/logError 的输出字节与 console.log/console.error
 * 逐字一致（见 __tests__/command-contract.test.ts），CLI 语法与文案冻结。
 */

import { format } from 'util';

/**
 * 命令判定类别。
 * 对外退出码只有 0/1（历史面），语义放进 kind，码值映射收敛在 bin。
 */
export type CommandKind = 'ok' | 'skip' | 'fail' | 'usage-error';

/**
 * 命令实现返回值（判别联合）。
 * `fail` / `usage-error` 必附 `reason`，且 reason 要能唯一定位失败点
 * （多闸门命令须含闸门标识）；`skip` 可选附原因。
 */
export type CommandResult =
  | { kind: 'ok' }
  | { kind: 'skip'; reason?: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'usage-error'; reason: string };

/**
 * 命令输出流注入面（最小可写接口，`process.stdout` / `process.stderr` 结构化满足）
 */
export interface CommandIO {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
}

/** 缺省 io：process 标准流（bin 不注入时的现状行为） */
export const processIO: CommandIO = {
  stdout: process.stdout,
  stderr: process.stderr,
};

/**
 * 与 console.log 同语义（util.format + 换行）写入 io.stdout
 */
export function log(io: CommandIO, ...args: unknown[]): void {
  io.stdout.write(format(...args) + '\n');
}

/**
 * 与 console.error 同语义（util.format + 换行）写入 io.stderr
 */
export function logError(io: CommandIO, ...args: unknown[]): void {
  io.stderr.write(format(...args) + '\n');
}

/**
 * 捕获型 io：测试注入面，替代 `spyOn(process, 'exit')` 时代的彩色字符串断言。
 */
export interface CapturingIO extends CommandIO {
  /** 已写入 stdout 的全部文本 */
  outText(): string;
  /** 已写入 stderr 的全部文本 */
  errText(): string;
  /** stdout 按行切分（末尾换行不产生空尾行） */
  outLines(): string[];
  /** stderr 按行切分（末尾换行不产生空尾行） */
  errLines(): string[];
  /** stdout 每次写入的原始文本（一次 log 调用 = 一条记录，等价旧的 console.log 调用参数视图） */
  outRecords(): string[];
  /** stderr 每次写入的原始文本 */
  errRecords(): string[];
}

export function captureIO(): CapturingIO {
  let out = '';
  let err = '';
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const split = (text: string): string[] =>
    text.endsWith('\n') ? text.slice(0, -1).split('\n') : (text === '' ? [] : text.split('\n'));
  return {
    stdout: { write: (chunk: string) => { out += chunk; outChunks.push(chunk); return true; } },
    stderr: { write: (chunk: string) => { err += chunk; errChunks.push(chunk); return true; } },
    outText: () => out,
    errText: () => err,
    outLines: () => split(out),
    errLines: () => split(err),
    outRecords: () => [...outChunks],
    errRecords: () => [...errChunks],
  };
}
