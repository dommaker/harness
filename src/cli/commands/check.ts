/**
 * harness check 命令
 *
 * 检查约束是否满足（三层：Iron Laws / Guidelines / Tips）
 * 工单 23：触发条件与证据检测迁至 core/constraints/context-builder；--preset 接入 applyPreset
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { constraintChecker } from '../../core/constraints/checker';
import { getTraceCollector } from '../../monitoring/traces';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../core/constraints/definitions';
import { ProjectConfigLoader } from '../../core/project-config-loader';
import { buildConstraintContext } from '../../core/constraints/context-builder';
import { applyPreset } from '../../presets';
import type { ConstraintTrigger } from '../../types/constraint';

export interface CheckOptions {
  /** 预设名称 */
  preset: string;
  /** 是否只检查暂存文件 */
  staged: boolean;
  /** 触发条件 */
  trigger?: ConstraintTrigger;
  /** 项目路径 */
  projectPath?: string;
}

/**
 * 执行约束检查
 */
export async function check(options: CheckOptions): Promise<void> {
  console.log(chalk.blue('🔍 检查约束...'));
  console.log(chalk.gray(`预设: ${options.preset}`));

  try {
    // 加载项目级自定义约束
    const projectPath = options.projectPath || process.cwd();
    const configLoader = new ProjectConfigLoader(projectPath);
    configLoader.load();
    constraintChecker.setTraceRecorder(getTraceCollector());

    if (configLoader.hasCustomConfig()) {
      const merged = configLoader.mergeConstraints();
      constraintChecker.setCustomConfig(merged);
      console.log(chalk.gray(`自定义约束: ${merged.custom.length} 条`));
      if (merged.disabled.length > 0) {
        console.log(chalk.gray(`已禁用约束: ${merged.disabled.join(', ')}`));
      }
    }

    // 构建上下文（工单 23：触发条件与证据检测收敛至 core/constraints/context-builder）
    const context = await buildConstraintContext({
      projectPath: options.projectPath,
      staged: options.staged,
      trigger: options.trigger,
    });
    const changedFiles = context.changedFiles ?? [];
    if (changedFiles.length > 0) {
      console.log(chalk.gray(`变更文件: ${changedFiles.length} 个`));
    }
    console.log(chalk.gray(`触发条件: ${context.operation}`));

    // 预设（工单 23：--preset 真正生效；项目自定义配置优先于预设）
    let presetConfig;
    if (!configLoader.hasCustomConfig()) {
      try {
        presetConfig = applyPreset(options.preset || 'standard');
      } catch {
        presetConfig = undefined; // 未知预设名回退内置全集
      }
    }

    // 执行三层检查
    const result = await constraintChecker.checkConstraints(context, presetConfig);

    // 输出结果
    console.log();

    // Iron Laws
    const ironLawViolations = result.ironLaws.filter(r => !r.satisfied);
    if (ironLawViolations.length === 0 && result.ironLaws.length > 0) {
      console.log(chalk.green(`✅ 铁律: 全部通过 (${result.ironLaws.length} 条)`));
    } else if (ironLawViolations.length > 0) {
      console.log(chalk.red(`❌ 铁律违规: ${ironLawViolations.length} 条`));
      ironLawViolations.forEach(r => {
        if (r.constraint) {
          console.log(chalk.red(`   - ${r.constraint.id}: ${r.constraint.message}`));
          console.log(chalk.red(`     ${r.constraint.rule}`));
        }
      });
      console.log();
      console.log(chalk.red('🛑 铁律检查失败，请修复后再提交'));
      process.exit(1);
    }

    // Guidelines
    if (result.warningCount > 0) {
      console.log(chalk.yellow(`⚠️  指导原则警告: ${result.warningCount} 条`));
      result.guidelines.filter(r => !r.satisfied).forEach(r => {
        if (r.constraint) {
          console.log(chalk.yellow(`   - ${r.constraint.id}: ${r.constraint.message}`));
        }
      });
    } else if (result.guidelines.length > 0) {
      const passedGuidelines = result.guidelines.filter(r => r.satisfied).length;
      console.log(chalk.green(`✅ 指导原则: ${passedGuidelines}/${result.guidelines.length} 通过`));
    }

    // Tips
    if (result.tipCount > 0) {
      console.log(chalk.blue(`💡 提示: ${result.tipCount} 条`));
      result.tips.filter(r => !r.satisfied).forEach(r => {
        if (r.constraint) {
          console.log(chalk.blue(`   - ${r.constraint.id}: ${r.constraint.message}`));
        }
      });
    }

    console.log();
    console.log(chalk.green('✅ 约束检查通过'));

    // 智能提示
    const hint = await getSmartHint(projectPath);
    if (hint) {
      console.log();
      console.log(chalk.gray('────────────────────────────────────'));
      console.log(hint);
      console.log(chalk.gray('────────────────────────────────────'));
    }
  } catch (error) {
    console.log();
    console.log(chalk.red(`❌ 约束检查异常: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

/**
 * 智能提示：检查是否需要提示用户下一步操作
 */
async function getSmartHint(projectPath: string): Promise<string | null> {
  const tracesPath = path.join(projectPath, '.harness', 'traces', 'execution.log');
  const statePath = path.join(projectPath, '.harness', '.state.json');
  
  // 检查 trace 文件是否存在
  if (!fs.existsSync(tracesPath)) {
    return null;
  }
  
  // 读取 trace 记录数
  const tracesContent = fs.readFileSync(tracesPath, 'utf-8');
  const lines = tracesContent.trim().split('\n').filter(Boolean);
  const traceCount = lines.length;
  
  // 读取状态
  let state: { 
    shownHints?: string[];
    lastStatusRun?: string;
    lastDiagnoseRun?: string;
  } = {};
  if (fs.existsSync(statePath)) {
    state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  }
  state.shownHints = state.shownHints || [];
  
  const hints: string[] = [];
  
  // 条件 1: 记录数首次达到 50
  if (traceCount >= 50 && !state.shownHints.includes('trace_50')) {
    hints.push('📊 记录已足够，运行 harness status 查看统计');
    state.shownHints.push('trace_50');
  }
  
  // 条件 2: 记录数达到 100 且从未运行过诊断
  if (traceCount >= 100 && !state.lastDiagnoseRun && !state.shownHints.includes('flow_suggest')) {
    hints.push('💡 数据充足，建议运行 harness flow 查看诊断');
    state.shownHints.push('flow_suggest');
  }
  
  // 条件 3: 检查异常趋势（简单检查绕过率）
  const bypassCount = lines.filter(line => {
    try {
      const trace = JSON.parse(line);
      return trace.result === 'bypassed';
    } catch {
      return false;
    }
  }).length;
  
  const bypassRate = traceCount > 10 ? bypassCount / traceCount : 0;
  if (bypassRate > 0.3 && !state.shownHints.includes('high_bypass')) {
    hints.push('⚠️ 发现异常趋势，建议运行 harness status 查看详情');
    state.shownHints.push('high_bypass');
  }
  
  // 保存状态
  if (hints.length > 0) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return hints.join('\n');
  }
  
  return null;
}

/**
 * 列出所有约束
 */
export function listLaws(): void {
  console.log(chalk.blue('\n📜 所有约束:\n'));

  // Iron Laws
  console.log(chalk.red('🔴 铁律 (Iron Laws) - 绝对禁止，无例外:\n'));
  Object.values(IRON_LAWS).forEach(constraint => {
    console.log(chalk.red(`  ${constraint.id}`));
    console.log(chalk.gray(`    ${constraint.rule}`));
    console.log(chalk.gray(`    ${constraint.message}`));
    console.log();
  });

  // Guidelines
  console.log(chalk.yellow('🟡 指导原则 (Guidelines) - 优先建议，有例外:\n'));
  Object.values(GUIDELINES).forEach(constraint => {
    console.log(chalk.yellow(`  ${constraint.id}`));
    console.log(chalk.gray(`    ${constraint.rule}`));
    console.log(chalk.gray(`    ${constraint.message}`));
    if (constraint.exceptions && constraint.exceptions.length > 0) {
      console.log(chalk.gray(`    例外: ${constraint.exceptions.join(', ')}`));
    }
    console.log();
  });

  // Tips
  console.log(chalk.blue('🔵 提示 (Tips) - 信息性，可忽略:\n'));
  Object.values(TIPS).forEach(constraint => {
    console.log(chalk.blue(`  ${constraint.id}`));
    console.log(chalk.gray(`    ${constraint.rule}`));
    console.log(chalk.gray(`    ${constraint.message}`));
    console.log();
  });
}
