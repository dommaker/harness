/**
 * file-exists 模板：文件存在性约束（ADR-0033，块 3 子项 2）
 *
 * 形态参照 context-doc-sync：存在性判定 + 证据行（fail 必须可归因，harness#119）。
 * 与 context-doc-sync 的差别：目标由参数显式给出（加载期已校验），
 * 无「约定未采用」三态，故永不 skip。
 *
 * 参数：
 * - path（可选）：相对项目根的单文件路径
 * - glob（可选）：文件集 glob（fast-glob 口径，dot: true 以覆盖 .harness 等点目录）
 * - mustExist（可选，缺省 true）：true = 必须存在；false = 必须不存在
 * path 与 glob 至少填一个；都填 = 两者都要满足。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import * as glob from 'fast-glob';
import { formatEvidence, type ConstraintCheck, type TemplatedCheckerFactory } from '../types';

export const fileExists: TemplatedCheckerFactory = {
  validateParams(params) {
    const errors: string[] = [];
    if (params.path !== undefined && typeof params.path !== 'string') {
      errors.push('path 必须是字符串');
    }
    if (params.glob !== undefined && typeof params.glob !== 'string') {
      errors.push('glob 必须是字符串');
    }
    const hasPath = typeof params.path === 'string' && params.path.length > 0;
    const hasGlob = typeof params.glob === 'string' && params.glob.length > 0;
    if (!hasPath && !hasGlob) {
      errors.push('path 或 glob 至少填一个');
    }
    if (params.mustExist !== undefined && typeof params.mustExist !== 'boolean') {
      errors.push('mustExist 必须是布尔值');
    }
    return errors;
  },

  create(id, params): ConstraintCheck {
    const rel = params.path as string | undefined;
    const globPattern = params.glob as string | undefined;
    const mustExist = params.mustExist !== false;

    return {
      id,
      evaluate(env) {
        const pathHit = rel !== undefined && existsSync(join(env.projectPath, rel));
        const globHits = globPattern !== undefined
          ? glob.sync(globPattern, { cwd: env.projectPath, dot: true, onlyFiles: false })
          : [];

        if (mustExist) {
          const missing: string[] = [];
          if (rel !== undefined && !pathHit) missing.push(rel);
          if (globPattern !== undefined && globHits.length === 0) missing.push(`${globPattern}（无匹配文件）`);
          if (missing.length > 0) {
            return { pass: false, evidence: formatEvidence('必需文件不存在', missing) };
          }
          return true;
        }

        // mustExist=false：任何目标存在即违规
        const present: string[] = [
          ...(pathHit ? [rel!] : []),
          ...globHits,
        ];
        if (present.length > 0) {
          return { pass: false, evidence: formatEvidence('禁存文件存在', present) };
        }
        return true;
      },
    };
  },
};
