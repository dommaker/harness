/**
 * 约束定义查找（内置 + 应用层，ADR-0033）
 *
 * 单一口径正本（ADR-0040 Phase 3）：原 findRetireTarget（constraint-lifecycle）与
 * findProposalTarget（pack-proposal）同形两份、只差返回字段，并为本查找 + 调用方投影。
 *
 * target 不传 = 只查内置（历史行为）；传项目根路径或观察面 = 并入应用层
 * （`.harness/constraints.yml`）查找。
 */

import { getConstraint } from './definitions';
import { loadAppConstraints } from '../app-constraints-loader';
import type { RunTarget } from './run-env';
import type { Constraint } from '../../types/constraint';

/** 按 id 查找约束定义（内置优先，应用层次之），未命中返回 undefined */
export function findConstraintDefinition(id: string, target?: RunTarget): Constraint | undefined {
  const builtIn = getConstraint(id);
  if (builtIn) return builtIn;
  if (target !== undefined) {
    return loadAppConstraints(target).find(c => c.id === id);
  }
  return undefined;
}
