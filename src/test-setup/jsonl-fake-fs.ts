/**
 * JSONL 有界读的 fs 假件（测试夹具层）
 *
 * 背景：`utils/jsonl` 的 tail/head 是分块有界读（`openSync` + `fstatSync` + `readSync` +
 * `closeSync`，ADR-0023 决策 3）。把整个 `fs` 模块 mock 掉的测试原先只提供了全文读入口
 * `readFileSync`，于是走有界读的被测代码直接抛错，再被它自己的 `catch` 吞成「数据不存在」
 * 一类的假象（session-manager 报 `Checkpoint 不存在`、context-tracker 读出空快照都是这样）。
 *
 * 口径一（同源）：内容经 `readFile(path)` 现取，直接把 `readFileSync` 那个 mock 包一层即可——
 * 测试改了它的返回值，两条读入口看到的就是同一个文件。
 * 口径二（按路径分派）：`openSync` 收到的路径必须传到后面三次调用上。有的假件按路径参数
 * 冒充多个文件（`if (p.includes('events.jsonl')) ...`），丢了路径就会读到别的文件或直接空。
 */

/** 有界读用到的四个 fs 入口，形状与 `fs` 对应函数一致 */
export interface BoundedReadChain {
  openSync: (path: string, flags?: string) => number;
  fstatSync: (fd: number) => { size: number };
  readSync: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ) => number;
  closeSync: (fd: number) => void;
}

/**
 * 以 `readFile(path)` 为唯一内容源，凑出有界读所需的四个 fs 入口
 *
 * 非字符串（含 mock 未设置时的 `undefined`）按空文件处理。不用 `jest.fn()` 包：本夹具只需
 * 行为正确；要数调用次数，在调用点自己套一层。
 */
export function jsonlBoundedReadChain(readFile: (path: string) => unknown): BoundedReadChain {
  const bytesOf = (path: string): Buffer => {
    const raw = readFile(path);
    return Buffer.from(typeof raw === 'string' ? raw : '', 'utf-8');
  };
  const openPaths = new Map<number, string>();
  let nextFd = 100;
  return {
    openSync: path => {
      const fd = nextFd++;
      openPaths.set(fd, String(path));
      return fd;
    },
    fstatSync: fd => ({ size: bytesOf(openPaths.get(fd) ?? '').length }),
    readSync: (fd, buffer, offset, length, position) => {
      const bytes = bytesOf(openPaths.get(fd) ?? '');
      // 真 readSync 在 position 越过 EOF 时返回 0；Buffer.copy 遇 sourceStart 超范围会抛
      if (position >= bytes.length) return 0;
      return bytes.copy(buffer, offset, position, position + length);
    },
    closeSync: fd => {
      openPaths.delete(fd);
    },
  };
}
