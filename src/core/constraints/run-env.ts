/**
 * 运行级观察面（ADR-0023 决策 1）
 *
 * 一次 `harness check` 一份、跑完即弃：把「本项目有哪些源码根」「最近的 trace 记录」这类
 * 上行数据的读取收在此处，同一次运行内每个文件至多读一次。
 *
 * 为什么不是一个对象而是两个：checker 拿到的 `CheckEnv` 里含 `context`，而 `context` 正是
 * context-builder **通过本对象读文件算出来的**——同一对象不能既是构造者的输入又是它的产物。
 * 故这里只放「不需要 context 就能造」的部分，`CheckEnv` 之后从它派生（见 checkers/types.ts）。
 *
 * 与 #87 的 git 证据同一形状：一次运行一份、经参数显式传下去，不做进程级单例——
 * 测试在同进程内反复改文件，常驻缓存会把「先改后读」读成老内容。
 */

import * as path from 'path';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { readJsonlWindow, type JsonlWindow, type JsonlReadResult } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../types/trace';

/**
 * 尾部窗口上限 = 本 run 内最大的尾部消费方（有无失败记录看 20 条，见 context-builder）
 *
 * 更小的窗口（验证证据看 10 条）从同一份行文本上截，不再二次读文件。
 */
const TRACE_TAIL_WINDOW = 20;

export interface RunEnv {
  /** 项目根（生产代码的每个 IO 点都用它，不再各自取 cwd——harness#95） */
  readonly projectPath: string;
  /** 最近 limit 条 trace 记录（≤ TRACE_TAIL_WINDOW；一次运行内至多读文件一次） */
  traceTail(limit: number): JsonlReadResult<ExecutionTrace>;
  /** 源码根相对路径列表（一次运行内至多探测一次） */
  sourceRoots(): string[];
}

/**
 * 构造运行级观察面
 *
 * 懒建：没有消费方就不碰文件（`harness check` 在干净树与脏树上读的并不一样多）。
 */
export function createRunEnv(projectPath: string): RunEnv {
  const traceFile = path.join(projectPath, DEFAULT_TRACE_FILE);
  let window: JsonlWindow<ExecutionTrace> | null = null;
  let roots: string[] | null = null;

  return {
    projectPath,
    traceTail(limit: number) {
      if (!window) {
        // 计数去向：豁免（harness#100）——本观察面只供给「最近有无 fail / 有无 pass」两个
        // 布尔证据的消费方，它们不读 skippedLines；坏行占尾部槽位只会让证据变少（方向保守），
        // 告知需要改判定形状，属行为变更不在本票（口径与改前的两处独立 tail 读逐字一致）
        window = readJsonlWindow<ExecutionTrace>(traceFile, 'skip', TRACE_TAIL_WINDOW);
      }
      return window.take(limit);
    },
    sourceRoots() {
      if (!roots) {
        roots = detectSourceRoots(projectPath);
      }
      return roots;
    },
  };
}

export { TRACE_TAIL_WINDOW };
