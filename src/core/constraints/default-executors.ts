/**
 * 内置 enforcement executors
 *
 * 将约束定义中的 enforcement ID 连接到实际的检查逻辑。
 */

import type { EnforcementExecutor, EnforcementResult, EnforcementContext } from '../../types/enforcement';
import { constraintInterceptor } from './interceptor';

/**
 * architecture-check: 调用 ArchitectureConstraintEngine
 */
const architectureCheckExecutor: EnforcementExecutor = {
  description: '架构规则引擎检查',
  async execute(context: EnforcementContext): Promise<EnforcementResult> {
    const { ArchitectureConstraintEngine } = await import('../../architecture/constraint-engine');
    const { loadArchitectureRules } = await import('../../architecture/constraint-engine');

    const configPath = context.projectPath
      ? `${context.projectPath}/.architect/rules.yml`
      : '.architect/rules.yml';

    try {
      const rules = await loadArchitectureRules(configPath);
      if (rules.length === 0) {
        return { passed: true, message: '无架构规则配置，跳过检查' };
      }

      const engine = new ArchitectureConstraintEngine(rules);
      const result = await engine.check({
        files: context.params?.changedFiles || [],
        diff: '',
      });

      return {
        passed: result.passed,
        message: result.passed
          ? '架构检查通过'
          : `${result.violations.length} 个架构违规`,
        evidence: result.violations.map(v => `${v.ruleId}: ${v.message}`).join('\n'),
      };
    } catch (error) {
      return {
        passed: false,
        message: `架构规则加载失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * cross-project-check: 调用 checkCrossProjectContracts
 */
const crossProjectCheckExecutor: EnforcementExecutor = {
  description: '跨工程接口契约检查',
  async execute(context: EnforcementContext): Promise<EnforcementResult> {
    const { checkCrossProjectContracts } = await import('../../architecture/cross-project-checker');
    const params = context.params || {};

    try {
      const violations = await checkCrossProjectContracts({
        baseBranch: params.baseBranch || 'main',
        changedProjects: params.changedProjects || [],
        changedFiles: params.changedFiles || [],
      }, {
        dependencies: params.dependencies || {},
        contractLocations: params.contractLocations || {},
      });

      return {
        passed: violations.length === 0,
        message: violations.length === 0
          ? '跨工程检查通过'
          : `${violations.length} 个跨工程违规`,
        evidence: violations.map(v => `${v.type}: ${v.message}`).join('\n'),
      };
    } catch (error) {
      return {
        passed: false,
        message: `跨工程检查失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * 注册所有内置 executors
 */
export function registerDefaultExecutors(): void {
  constraintInterceptor.register('architecture-check', architectureCheckExecutor, 'builtin');
  constraintInterceptor.register('cross-project-check', crossProjectCheckExecutor, 'builtin');
}
