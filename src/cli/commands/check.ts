/**
 * harness check 命令
 *
 * 检查约束是否满足（check 层：Iron Laws / Guidelines；prompt 层仅注入不检查）
 * 工单 23：触发条件与证据检测迁至 core/constraints/context-builder；--preset 经 mergeConstraints 生效
 * ADR-0001：约束集统一走 mergeConstraints 生效集链路（preset/config 禁用/custom/scenes）
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { constraintChecker } from '../../core/constraints/checker';
import { getTraceCollector } from '../../monitoring/traces';
import { IRON_LAWS, GUIDELINES, PROMPTS } from '../../core/constraints/definitions';
import { ProjectConfigLoader } from '../../core/project-config-loader';
import { buildConstraintContext } from '../../core/constraints/context-builder';
import { detectInjectionDrift } from '../../core/constraints/injection-drift';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
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

    // 生效约束集（ADR-0001）：内置 → preset → config.yml 禁用 → custom 追加 → scenes 过滤。
    // --preset 仅在没有项目自定义配置时覆盖 config.yml 的 preset（保持工单 23 语义：
    // 项目自定义配置优先于 CLI 预设）。
    const merged = configLoader.hasCustomConfig()
      ? configLoader.mergeConstraints()
      : configLoader.mergeConstraints({ preset: options.preset || 'standard' });
    if (merged.custom.length > 0) {
      console.log(chalk.gray(`自定义约束: ${merged.custom.length} 条`));
    }
    if (merged.disabled.length > 0) {
      console.log(chalk.gray(`已禁用约束: ${merged.disabled.join(', ')}`));
    }
    const unknownIds = merged.unknownIds ?? [];
    if (unknownIds.length > 0) {
      console.log(chalk.yellow(`⚠️  配置中存在未知约束 id（已忽略，可清理）: ${unknownIds.join(', ')}`));
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
    console.log(chalk.gray(`触发条件: ${[context.operation, ...(context.extraTriggers ?? [])].join(', ')}`));

    // 执行三层检查（per-request 传 customConfig，避免单例状态污染）
    const result = await constraintChecker.checkConstraints(context, merged);

    // 输出结果
    console.log();

    // skipped（约定未采用/证据未接线）单独列示，不进 pass/fail 统计（ADR-0001）
    const skippedResults = [
      ...result.ironLaws,
      ...result.guidelines,
    ].filter(r => r.skipped);

    // Iron Laws
    const evaluatedIronLaws = result.ironLaws.filter(r => !r.skipped);
    const ironLawViolations = evaluatedIronLaws.filter(r => !r.satisfied);
    if (ironLawViolations.length === 0 && evaluatedIronLaws.length > 0) {
      console.log(chalk.green(`✅ 铁律: 全部通过 (${evaluatedIronLaws.length} 条)`));
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
      const evaluatedGuidelines = result.guidelines.filter(r => !r.skipped);
      const passedGuidelines = evaluatedGuidelines.filter(r => r.satisfied).length;
      console.log(chalk.green(`✅ 指导原则: ${passedGuidelines}/${evaluatedGuidelines.length} 通过`));
    }

    // Skipped：约定未采用 / 证据未接线，未评估（不计通过/失败）
    if (skippedResults.length > 0) {
      console.log(chalk.gray(`⏭️  跳过评估: ${skippedResults.length} 条（约定未采用或证据未接线，不计通过/失败）`));
      skippedResults.forEach(r => {
        console.log(chalk.gray(`   - ${r.id}`));
      });
    }

    // 注入漂移校验（ADR-0001 决策 7）：黄色警告块，不改 exit code、不影响门禁结果。
    // 无漂移/未注入零输出；漂移检测自身异常静默吞掉，绝不影响 check。
    try {
      const drift = detectInjectionDrift(projectPath);
      if (drift.hasDrift) {
        console.log();
        console.log(chalk.yellow('⚠️  检测到 CLAUDE.md 约束注入漂移（仅警告，不阻断）:'));
        if (drift.versionDrift) {
          console.log(chalk.yellow(`   ⚠️⚠️ 注入段版本 (${drift.versionDrift.actual}) ≠ 已安装 harness 版本 (${drift.versionDrift.expected})：agent 上下文中的规则与已安装 harness 版本不一致`));
        }
        if (drift.contentDrift) {
          console.log(chalk.yellow(`   内容漂移: 缺失 ${drift.contentDrift.missing.length} 条 / 多余 ${drift.contentDrift.extra.length} 条（条目级差异见 harness constraints report）`));
        }
        if (drift.duplicateHeading) {
          console.log(chalk.yellow('   检测到重复的 "## Governance Rules" 章节'));
        }
        console.log(chalk.yellow(`   修复: ${drift.fixHint}`));
      }
    } catch {
      // 漂移检测失败不影响 check 结果
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
  const tracesPath = path.join(projectPath, DEFAULT_TRACE_FILE);
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
  
  // 条件 2: 检查异常趋势（简单检查绕过率）
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

  // Prompts（ADR-0001：纯注入层，不执行检查）
  console.log(chalk.blue('🔵 提示 (Prompts) - 纯文本注入，不参与检查:\n'));
  Object.values(PROMPTS).forEach(constraint => {
    console.log(chalk.blue(`  ${constraint.id}`));
    console.log(chalk.gray(`    ${constraint.rule}`));
    console.log(chalk.gray(`    ${constraint.message}`));
    console.log();
  });
}
