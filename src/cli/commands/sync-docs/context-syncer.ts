/**
 * CONTEXT.md 写侧落点（工单 22 / harness#150）：缺失模板生成走 scaffold 正本站点。
 *
 * P2.8 采集侧（发现/mtime/导出面/构造点计数）已下沉 core/docs-sync/context-collector.ts，
 * 本文件只剩写入。判定本体在 core/constraints/ 的纯函数。
 */

import type { CommandIO } from '../../command-contract';
import {
  contextDocFile,
  nodeScaffoldFs,
  runPlan,
  type ScaffoldFileSystem,
  type ScaffoldOutcome,
} from '../scaffold';

/**
 * 创建 CONTEXT.md 模板：走 scaffold 正本站点（contextDocFile + runPlan），
 * 与 init 的 CONTEXT.md 落点共用同一份模板正文（harness#150，#132 口径外的第 9 处）。
 *
 * 只在 `contextMissing` 的目录上被调用，故正常只走 `created`；若落到 `exists`
 * 说明 sync-docs 的缺失判定与 scaffold 的在场判定口径不一致（不静默兜，交由调用方感知）。
 */
export async function createContextMd(
  projectPath: string,
  dir: string,
  io: CommandIO,
  scaffoldFs: ScaffoldFileSystem = nodeScaffoldFs,
): Promise<ScaffoldOutcome> {
  const [outcome] = await runPlan([contextDocFile(projectPath, dir)], io, scaffoldFs);
  return outcome;
}
