/**
 * harness constraints -- 约束集合元数据导出
 *
 * 纯数据导出，不调用 LLM，不访问文件系统（除 definitions.ts）。
 * 供下游消费方获取约束的 hash、计数等元数据。
 *
 * harness#198：元数据函数已搬入 `core/constraints/meta` 并上公共 barrel
 * （消费方免起子进程）；本模块是 CLI 薄壳——--json / 文本两种打印形态。
 */

import { getConstraintsMeta } from '../../core/constraints/meta';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export { getConstraintsMeta };
export type { ConstraintsMeta } from '../../core/constraints/meta';

/**
 * CLI handler: output --json
 */
export async function constraints(options: { json?: boolean }, io: CommandIO = processIO): Promise<CommandResult> {
  const meta = getConstraintsMeta();
  if (options.json) {
    log(io, JSON.stringify(meta, null, 2));
  } else {
    log(io, `version: ${meta.version}`);
    log(io, `hash: ${meta.hash}`);
    log(io, `errors: ${meta.counts.errors}, warnings: ${meta.counts.warnings}`);
  }
  return { kind: 'ok' };
}
