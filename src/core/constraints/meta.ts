/**
 * 约束集合元数据（库面，harness#198）
 *
 * `harness constraints --json` 背后的元数据函数：version/hash/counts。
 * 纯数据导出，不调用 LLM，不访问文件系统（除 definitions.ts）。
 * 下游消费方经公共 barrel 直接调用，免起 `npx harness constraints --json`
 * 子进程。CLI 命令是调用本函数的薄壳。
 */

import { createHash } from 'crypto';
import { getAllConstraints } from './definitions';
import { getHarnessPackageVersion } from '../../utils/package-version';

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
