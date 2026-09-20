/**
 * harness constraints -- 约束集合元数据导出
 *
 * 纯数据导出，不调用 LLM，不访问文件系统（除 definitions.ts）。
 * 供 Studio 等消费者获取约束的 hash、计数等元数据。
 */

import { createHash } from 'crypto';
import { getAllConstraints } from '../../core/constraints/definitions';
import { getHarnessPackageVersion } from '../../utils/package-version';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ConstraintsMeta {
  version: string;
  hash: string;
  counts: { errors: number; warnings: number };
}

export function getConstraintsMeta(): ConstraintsMeta {
  const constraints = getAllConstraints();

  const errors = constraints.filter(c => c.severity === 'error');
  const warnings = constraints.filter(c => c.severity === 'warning');

  // 稳定 JSON 序列化后取 hash（内容面 = id + severity + 规则文本）
  const hashInput = JSON.stringify(
    constraints.map(c => ({ id: c.id, severity: c.severity, rule: c.rule, message: c.message, description: c.description }))
  );
  const hash = createHash('sha256').update(hashInput).digest('hex');

  return {
    version: getHarnessPackageVersion(),
    hash,
    counts: {
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

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
