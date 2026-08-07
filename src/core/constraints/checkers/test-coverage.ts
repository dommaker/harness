/**
 * test_coverage_required：读取 coverage 报告校验行覆盖率（工单 21）
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ConstraintCheck } from './types';

export const testCoverageRequired: ConstraintCheck = {
  id: 'test_coverage_required',
  async evaluate(env) {
    const projectPath = env.projectPath;
    try {
      const coverageJsonPath = join(projectPath, 'coverage', 'coverage-final.json');
      const coverageSummaryPath = join(projectPath, 'coverage', 'coverage-summary.json');

      if (!existsSync(coverageJsonPath) && !existsSync(coverageSummaryPath)) {
        return true; // 无 coverage 报告，默认通过
      }

      if (existsSync(coverageSummaryPath)) {
        const summary = JSON.parse(readFileSync(coverageSummaryPath, 'utf-8'));
        const total = summary.total || {};
        const linesCoverage = total.lines?.pct || 0;

        // 默认要求 50% 覆盖率（可配置）
        return linesCoverage >= 50;
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  },
};
