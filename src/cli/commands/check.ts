/**
 * harness check 命令
 *
 * 检查约束是否满足（check 层：Iron Laws / Guidelines；prompt 层仅注入不检查）
 * 工单 23：触发条件与证据检测迁至 core/constraints/context-builder
 * ADR-0001：约束集统一走 getMergedConstraintsConfig 生效集链路（preset/config 禁用/custom/scenes）
 * harness#88：本命令是 trace 记录器的组合根——core 不上行依赖 monitoring，
 * 真实收集器在此经构造参数接线
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { ConstraintChecker } from '../../core/constraints/checker';
import { IRON_LAWS, GUIDELINES, PROMPTS } from '../../core/constraints/definitions';
import { getMergedConstraintsConfig } from '../../core/effective-constraints';
import { buildConstraintContext } from '../../core/constraints/context-builder';
import { createGitEvidence, type GitEvidence } from '../../core/constraints/git-evidence';
import { detectInjectionDrift } from '../../core/constraints/injection-drift';
import { GOVERNANCE_HEADING } from '../../core/constraints/injection-writer';
import { getTraceCollector } from '../../monitoring/traces';
import { countJsonlLines } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
import type { ConstraintTrigger } from '../../types/constraint';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface CheckOptions {
  /** 预设名称 */
  preset: string;
  /** 是否只检查暂存文件 */
  staged: boolean;
  /** 触发条件 */
  trigger?: ConstraintTrigger;
  /** 项目路径 */
  projectPath?: string;
  /**
   * git 证据 adapter（非 CLI flag；#87）
   *
   * 缺省 = 本 run 独占一份真 git 证据。注入则与调用方共用同一证据快照，
   * 测试据此断言"同一 run 内每条 git 命令至多执行一次"。
   */
  evidence?: GitEvidence;
}

/**
 * 执行约束检查
 */
export async function check(
  options: CheckOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('🔍 检查约束...'));
  log(io, chalk.gray(`预设: ${options.preset}`));

  try {
    const projectPath = options.projectPath || process.cwd();

    // 生效约束集（ADR-0001）：内置 → preset → config.yml 禁用 → custom 追加 → scenes 过滤。
    // --preset 仅在没有项目自定义配置时覆盖 config.yml 的 preset（工单 23 语义：
    // 项目自定义配置优先于 CLI 预设），优先级规则收在 getMergedConstraintsConfig 一处。
    const merged = getMergedConstraintsConfig(projectPath, { preset: options.preset });
    if (merged.custom.length > 0) {
      log(io, chalk.gray(`自定义约束: ${merged.custom.length} 条`));
    }
    if (merged.disabled.length > 0) {
      log(io, chalk.gray(`已禁用约束: ${merged.disabled.join(', ')}`));
    }
    const unknownIds = merged.unknownIds ?? [];
    if (unknownIds.length > 0) {
      log(io, chalk.yellow(`⚠️  配置中存在未知约束 id（已忽略，可清理）: ${unknownIds.join(', ')}`));
    }

    // 构建上下文（工单 23：触发条件与证据检测收敛至 core/constraints/context-builder）
    // #87：一次 run 一份 git 证据——context-builder 与 checker 层共用同一实例
    const evidence = options.evidence ?? createGitEvidence(projectPath);
    const context = await buildConstraintContext({
      projectPath: options.projectPath,
      staged: options.staged,
      trigger: options.trigger,
      evidence,
    });
    const changedFiles = context.changedFiles ?? [];
    if (changedFiles.length > 0) {
      log(io, chalk.gray(`变更文件: ${changedFiles.length} 个`));
    }
    log(io, chalk.gray(`触发条件: ${[context.operation, ...(context.extraTriggers ?? [])].join(', ')}`));

    // 执行三层检查（per-request 传 customConfig，避免单例状态污染；证据同 run 同源）
    // trace 记录器经构造参数接线（harness#88）：一次命令一个 checker 实例
    const checker = new ConstraintChecker(getTraceCollector());
    const result = await checker.checkConstraints(context, merged, evidence);

    // 输出结果
    log(io);

    // skipped（约定未采用/证据未接线）单独列示，不进 pass/fail 统计（ADR-0001）
    const skippedResults = [
      ...result.ironLaws,
      ...result.guidelines,
    ].filter(r => r.skipped);

    // Iron Laws
    const evaluatedIronLaws = result.ironLaws.filter(r => !r.skipped);
    const ironLawViolations = evaluatedIronLaws.filter(r => !r.satisfied);
    if (ironLawViolations.length === 0 && evaluatedIronLaws.length > 0) {
      log(io, chalk.green(`✅ 铁律: 全部通过 (${evaluatedIronLaws.length} 条)`));
    } else if (ironLawViolations.length > 0) {
      log(io, chalk.red(`❌ 铁律违规: ${ironLawViolations.length} 条`));
      ironLawViolations.forEach(r => {
        if (r.constraint) {
          log(io, chalk.red(`   - ${r.constraint.id}: ${r.constraint.message}`));
          log(io, chalk.red(`     ${r.constraint.rule}`));
        }
      });
      log(io);
      log(io, chalk.red('🛑 铁律检查失败，请修复后再提交'));
      return {
        kind: 'fail',
        reason: `iron law violated: ${ironLawViolations.map(r => r.constraint?.id ?? 'unknown').join(', ')}`,
      };
    }

    // Guidelines
    if (result.warningCount > 0) {
      log(io, chalk.yellow(`⚠️  指导原则警告: ${result.warningCount} 条`));
      result.guidelines.filter(r => !r.satisfied).forEach(r => {
        if (r.constraint) {
          log(io, chalk.yellow(`   - ${r.constraint.id}: ${r.constraint.message}`));
        }
      });
    } else if (result.guidelines.length > 0) {
      const evaluatedGuidelines = result.guidelines.filter(r => !r.skipped);
      const passedGuidelines = evaluatedGuidelines.filter(r => r.satisfied).length;
      log(io, chalk.green(`✅ 指导原则: ${passedGuidelines}/${evaluatedGuidelines.length} 通过`));
    }

    // Skipped：约定未采用 / 证据未接线，未评估（不计通过/失败）
    if (skippedResults.length > 0) {
      log(io, chalk.gray(`⏭️  跳过评估: ${skippedResults.length} 条（约定未采用或证据未接线，不计通过/失败）`));
      skippedResults.forEach(r => {
        log(io, chalk.gray(`   - ${r.id}`));
      });
    }

    // 注入漂移校验（ADR-0001 决策 7）：黄色警告块，不改 exit code、不影响门禁结果。
    // 无漂移/未注入零输出；漂移检测自身异常静默吞掉，绝不影响 check。
    try {
      const drift = detectInjectionDrift(projectPath);
      if (drift.hasDrift) {
        log(io);
        log(io, chalk.yellow(`⚠️  检测到 ${drift.injectionFile ?? '治理文档'} 约束注入漂移（仅警告，不阻断）:`));
        if (drift.versionDrift) {
          log(io, chalk.yellow(`   ⚠️⚠️ 注入段版本 (${drift.versionDrift.actual}) ≠ 已安装 harness 版本 (${drift.versionDrift.expected})：agent 上下文中的规则与已安装 harness 版本不一致`));
        }
        if (drift.contentDrift) {
          log(io, chalk.yellow(`   内容漂移: 缺失 ${drift.contentDrift.missing.length} 条 / 多余 ${drift.contentDrift.extra.length} 条（条目级差异见 harness constraints report）`));
        }
        if (drift.duplicateHeading) {
          log(io, chalk.yellow(`   检测到重复的 "${GOVERNANCE_HEADING}" 章节`));
        }
        log(io, chalk.yellow(`   修复: ${drift.fixHint}`));
      }
    } catch {
      // 漂移检测失败不影响 check 结果
    }

    log(io);
    log(io, chalk.green('✅ 约束检查通过'));

    // 智能提示
    const hint = await getSmartHint(projectPath);
    if (hint) {
      log(io);
      log(io, chalk.gray('────────────────────────────────────'));
      log(io, hint);
      log(io, chalk.gray('────────────────────────────────────'));
    }
    return { kind: 'ok' };
  } catch (error) {
    log(io);
    log(io, chalk.red(`❌ 约束检查异常: ${error instanceof Error ? error.message : String(error)}`));
    return { kind: 'fail', reason: `check error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 智能提示：检查是否需要提示用户下一步操作
 */
async function getSmartHint(projectPath: string): Promise<string | null> {
  const tracesPath = path.join(projectPath, DEFAULT_TRACE_FILE);
  const statePath = path.join(projectPath, '.harness', '.state.json');

  // 只数非空行数（含坏行），零 parse——原语义不变，走 jsonl 正本（harness#82）
  const traceCount = countJsonlLines(tracesPath);
  if (traceCount === 0) {
    return null;
  }
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
/** optionRoutes 一律以 (options) 调用；--list 不消费检查选项，形参仅占位 */
export function listLaws(_options: Partial<CheckOptions> = {}, io: CommandIO = processIO): CommandResult {
  log(io, chalk.blue('\n📜 所有约束:\n'));

  // Iron Laws
  log(io, chalk.red('🔴 铁律 (Iron Laws) - 绝对禁止，无例外:\n'));
  Object.values(IRON_LAWS).forEach(constraint => {
    log(io, chalk.red(`  ${constraint.id}`));
    log(io, chalk.gray(`    ${constraint.rule}`));
    log(io, chalk.gray(`    ${constraint.message}`));
    log(io);
  });

  // Guidelines
  log(io, chalk.yellow('🟡 指导原则 (Guidelines) - 优先建议，违背发警告但不阻止:\n'));
  Object.values(GUIDELINES).forEach(constraint => {
    log(io, chalk.yellow(`  ${constraint.id}`));
    log(io, chalk.gray(`    ${constraint.rule}`));
    log(io, chalk.gray(`    ${constraint.message}`));
    log(io);
  });

  // Prompts（ADR-0001：纯注入层，不执行检查）
  log(io, chalk.blue('🔵 提示 (Prompts) - 纯文本注入，不参与检查:\n'));
  Object.values(PROMPTS).forEach(constraint => {
    log(io, chalk.blue(`  ${constraint.id}`));
    log(io, chalk.gray(`    ${constraint.rule}`));
    log(io, chalk.gray(`    ${constraint.message}`));
    log(io);
  });
  return { kind: 'ok' };
}
