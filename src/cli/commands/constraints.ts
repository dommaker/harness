/**
 * harness constraints -- 约束集合元数据导出
 *
 * 纯数据导出，不调用 LLM，不访问文件系统（除 definitions.ts）。
 * 供 Studio 等消费者获取约束的 hash、计数、文本大小等元数据。
 */

import { createHash } from 'crypto';
import { getAllConstraints } from '../../core/constraints/definitions';
import { getHarnessPackageVersion } from '../../utils/package-version';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ConstraintsMeta {
  version: string;
  hash: string;
  counts: { ironLaws: number; guidelines: number; prompts: number };
  textSize: { total: number; perConstraint: number };
}

export function getConstraintsMeta(): ConstraintsMeta {
  const constraints = getAllConstraints();

  const ironLaws = constraints.filter(c => c.level === 'iron_law');
  const guidelines = constraints.filter(c => c.level === 'guideline');
  const prompts = constraints.filter(c => c.level === 'prompt');

  // 计算总 promptInjection 文本长度（字符数，可估算 token）
  const totalTextSize = constraints
    .map(c => (c.promptInjection || '').length)
    .reduce((sum, len) => sum + len, 0);

  // 稳定 JSON 序列化后取 hash
  const hashInput = JSON.stringify({
    ironLaws: ironLaws.map(c => ({ id: c.id, promptInjection: c.promptInjection })),
    guidelines: guidelines.map(c => ({ id: c.id, promptInjection: c.promptInjection })),
    prompts: prompts.map(c => ({ id: c.id, promptInjection: c.promptInjection })),
  });
  const hash = createHash('sha256').update(hashInput).digest('hex');

  return {
    version: getHarnessPackageVersion(),
    hash,
    counts: {
      ironLaws: ironLaws.length,
      guidelines: guidelines.length,
      prompts: prompts.length,
    },
    textSize: {
      total: totalTextSize,
      perConstraint: constraints.length > 0 ? Math.round(totalTextSize / constraints.length) : 0,
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
    log(io, `ironLaws: ${meta.counts.ironLaws}, guidelines: ${meta.counts.guidelines}, prompts: ${meta.counts.prompts}`);
    log(io, `textSize: ${meta.textSize.total} chars total, ~${meta.textSize.perConstraint} chars/constraint`);
  }
  return { kind: 'ok' };
}
