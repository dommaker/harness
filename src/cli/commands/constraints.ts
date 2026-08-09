/**
 * harness constraints -- 约束集合元数据导出
 *
 * 纯数据导出，不调用 LLM，不访问文件系统（除 definitions.ts）。
 * 供 Studio 等消费者获取约束的 hash、计数、文本大小等元数据。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { getAllConstraints } from '../../core/constraints/definitions';

export interface ConstraintsMeta {
  version: string;
  hash: string;
  counts: { ironLaws: number; guidelines: number; prompts: number };
  textSize: { total: number; perConstraint: number };
}

function getPackageVersion(): string {
  // Try several common locations
  const candidates = [
    join(__dirname, '..', '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8')).version;
      } catch {
        // continue to next candidate
      }
    }
  }
  return 'unknown';
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
    version: getPackageVersion(),
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
export async function constraints(options: { json?: boolean }): Promise<void> {
  const meta = getConstraintsMeta();
  if (options.json) {
    console.log(JSON.stringify(meta, null, 2));
  } else {
    console.log(`version: ${meta.version}`);
    console.log(`hash: ${meta.hash}`);
    console.log(`ironLaws: ${meta.counts.ironLaws}, guidelines: ${meta.counts.guidelines}, prompts: ${meta.counts.prompts}`);
    console.log(`textSize: ${meta.textSize.total} chars total, ~${meta.textSize.perConstraint} chars/constraint`);
  }
}
