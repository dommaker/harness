/**
 * harness check 命令
 *
 * 检查约束是否满足（severity='error' 阻断 / severity='warning' 告警）
 * 工单 23：触发条件与证据检测迁至 core/constraints/context-builder
 * 约束集统一走 getMergedConstraintsConfig 生效集链路（preset/config 禁用）
 * harness#88：本命令是 trace 记录器的组合根——core 不上行依赖 monitoring，
 * 真实收集器在此经构造参数接线；#139：收集器锚根构造，trace 落点跟 --project-path 走
 */

import chalk from 'chalk';
import * as path from 'path';
import { ConstraintChecker } from '../../core/constraints/checker';
import { CONSTRAINTS } from '../../core/constraints/definitions';
import { getMergedConstraintsConfig } from '../../core/effective-constraints';
import { buildConstraintContext } from '../../core/constraints/context-builder';
import { createGitEvidence, type GitEvidence } from '../../core/constraints/git-evidence';
import { createRunEnv, type RunEnv } from '../../core/constraints/run-env';
import { TraceCollector } from '../../monitoring/traces';
import { readJsonl } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE, type ExecutionTrace } from '../../types/trace';
import type { ConstraintResult, ConstraintTrigger } from '../../types/constraint';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { fileStateIO, type StateIO } from '../state-io';

/** 证据行着色（与调用处所属结论块一致） */
const EVIDENCE_PAINT = {
  red: chalk.red,
  yellow: chalk.yellow,
  gray: chalk.gray,
} as const;

/**
 * 打印 checker 的判定证据行（harness#119）
 *
 * 文案由 checker 自行措辞（每行自描述），CLI 只负责缩进与着色——
 * 不在这里解释内容，否则证据形状与措辞会两头漂移。
 * 传 id 时首行挂上约束 id（提示块里没有父级结论行可依附）。
 */
function logEvidence(
  io: CommandIO,
  result: ConstraintResult,
  color: keyof typeof EVIDENCE_PAINT,
  id?: string
): void {
  const paint = EVIDENCE_PAINT[color];
  (result.evidence ?? []).forEach((line, index) => {
    log(io, paint(index === 0 && id ? `   - ${id}: ${line}` : `     ${line}`));
  });
}

export interface CheckOptions {
  /** 预设名称；**不传 = 按项目 `.harness/config.yml` 的 preset**（CLI 不给缺省值，见 commands/definitions.ts） */
  preset?: string;
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
  /**
   * 运行级观察面（非 CLI flag；ADR-0023）
   *
   * 缺省 = 本 run 独占一份。注入则与调用方共用同一份上行数据读取，
   * 测试据此断言「同一次运行内同一项目文件至多读一次」。
   */
  runEnv?: RunEnv;
  /**
   * 状态文件接缝（非 CLI flag；ADR-0026）
   *
   * 缺省 = 真实 fs 实现（fileStateIO）。注入则 `.harness/.state.json` 的读写
   * 走替身，测试据此不碰真文件系统。
   */
  stateIO?: StateIO;
}

/**
 * 执行约束检查
 */
export async function check(
  options: CheckOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('🔍 检查约束...'));
  log(io, chalk.gray(`预设: ${options.preset ?? '（按 config.yml，缺省 standard）'}`));

  try {
    const projectPath = options.projectPath || process.cwd();
    // 一次 run 一份证据与观察面（#87 / ADR-0023）：入口构造，沿生效集、context、checker 向下传
    const evidence = options.evidence ?? createGitEvidence(projectPath);
    const runEnv = options.runEnv ?? createRunEnv(projectPath);
    const stateIO = options.stateIO ?? fileStateIO(projectPath);

    // 生效约束集：内置 → preset → config.yml 禁用。
    // --preset 仅在没有项目自定义配置时覆盖 config.yml 的 preset（工单 23 语义：
    // 项目自定义配置优先于 CLI 预设），优先级规则收在 getMergedConstraintsConfig 一处。
    // CLI 不给 -p 缺省值：没传 = 尊重 config.yml（ADR-0023 步骤 4.5，缺省值曾让两者不可区分）
    const merged = getMergedConstraintsConfig(runEnv, { preset: options.preset });
    if (merged.disabled.length > 0) {
      log(io, chalk.gray(`已禁用约束: ${merged.disabled.join(', ')}`));
    }
    const unknownIds = merged.unknownIds ?? [];
    if (unknownIds.length > 0) {
      log(io, chalk.yellow(`⚠️  配置中存在未知约束 id（已忽略，可清理）: ${unknownIds.join(', ')}`));
    }

    // 构建上下文（工单 23：触发条件与证据检测收敛至 core/constraints/context-builder）
    // #87：一次 run 一份 git 证据——context-builder 与 checker 层共用同一实例
    // ADR-0023：一次 run 一份运行级观察面——配置、源根探测、trace 证据探测全部共用同一份读取
    const context = await buildConstraintContext({
      projectPath: options.projectPath,
      staged: options.staged,
      trigger: options.trigger,
      evidence,
      runEnv,
    });
    const changedFiles = context.changedFiles ?? [];
    if (changedFiles.length > 0) {
      log(io, chalk.gray(`变更文件: ${changedFiles.length} 个`));
    }
    log(io, chalk.gray(`触发条件: ${[context.operation, ...(context.extraTriggers ?? [])].join(', ')}`));

    // 执行约束检查（per-request 传 customConfig，避免单例状态污染；证据同 run 同源）
    // trace 记录器经构造参数接线（harness#88）：一次命令一个 checker 实例
    // #139：收集器锚根构造——不传 projectPath 时 trace 会落进调用方 cwd，B 侧读不到
    const checker = new ConstraintChecker(new TraceCollector({ projectPath }));
    const result = await checker.checkConstraints(context, merged, evidence, runEnv);

    // 输出结果
    log(io);

    // skipped（约定未采用/证据未接线）单独列示，不进 pass/fail 统计
    const skippedResults = [
      ...result.errors,
      ...result.warnings,
    ].filter(r => r.skipped);

    // severity='error'（违规即阻断）
    const evaluatedErrors = result.errors.filter(r => !r.skipped);
    const errorViolations = evaluatedErrors.filter(r => !r.satisfied);
    if (errorViolations.length === 0 && evaluatedErrors.length > 0) {
      log(io, chalk.green(`✅ error 级约束: 全部通过 (${evaluatedErrors.length} 条)`));
    } else if (errorViolations.length > 0) {
      log(io, chalk.red(`❌ error 级约束违规: ${errorViolations.length} 条`));
      errorViolations.forEach(r => {
        if (r.constraint) {
          log(io, chalk.red(`   - ${r.constraint.id}: ${r.constraint.message}`));
          log(io, chalk.red(`     ${r.constraint.rule}`));
          logEvidence(io, r, 'red');
        }
      });
      log(io);
      log(io, chalk.red('🛑 error 级约束检查失败，请修复后再提交'));
      return {
        kind: 'fail',
        reason: `error-severity constraint violated: ${errorViolations.map(r => r.constraint?.id ?? 'unknown').join(', ')}`,
      };
    }

    // severity='warning'（告警不阻断）
    if (result.warningCount > 0) {
      log(io, chalk.yellow(`⚠️  warning 级约束警告: ${result.warningCount} 条`));
      result.warnings.filter(r => !r.satisfied).forEach(r => {
        if (r.constraint) {
          log(io, chalk.yellow(`   - ${r.constraint.id}: ${r.constraint.message}`));
          logEvidence(io, r, 'yellow');
        }
      });
    } else if (result.warnings.length > 0) {
      const evaluatedWarnings = result.warnings.filter(r => !r.skipped);
      const passedWarnings = evaluatedWarnings.filter(r => r.satisfied).length;
      log(io, chalk.green(`✅ warning 级约束: ${passedWarnings}/${evaluatedWarnings.length} 通过`));
    }

    // 提示：通过但带证据（harness#119）——与本次变更无因果的仓库级漂移在此露出，
    // 不判违规、不改 exit code，只保证「看得见且能自己修」
    const hints = [...result.errors, ...result.warnings].filter(
      r => !r.skipped && r.satisfied && (r.evidence?.length ?? 0) > 0
    );
    if (hints.length > 0) {
      log(io, chalk.gray(`💡 提示: ${hints.length} 条（不判违规，供参考）`));
      hints.forEach(r => logEvidence(io, r, 'gray', r.id));
    }

    // Skipped：约定未采用 / 证据未接线，未评估（不计通过/失败）
    if (skippedResults.length > 0) {
      log(io, chalk.gray(`⏭️  跳过评估: ${skippedResults.length} 条（约定未采用或证据未接线，不计通过/失败）`));
      skippedResults.forEach(r => {
        log(io, chalk.gray(`   - ${r.id}`));
      });
    }

    log(io);
    log(io, chalk.green('✅ 约束检查通过'));

    // 智能提示
    const hint = await getSmartHint(projectPath, stateIO);
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

/** 智能提示阈值：trace 累计条数首次达到此数才提示跑 status（判定只要「够不够」，不要总数） */
const TRACE_HINT_THRESHOLD = 50;

/**
 * 智能提示：检查是否需要提示用户下一步操作
 *
 * 状态读写经 StateIO（ADR-0026）：读-改-写，`status` 不再把 `shownHints` 抹掉，
 * 「首次达到阈值」的去重自此真生效。
 */
async function getSmartHint(projectPath: string, stateIO: StateIO): Promise<string | null> {
  const tracesPath = path.join(projectPath, DEFAULT_TRACE_FILE);

  // 只读够 TRACE_HINT_THRESHOLD 行即停（坏行照旧占位，条数口径与改前的纯计数逐字一致）——
  // traces.log 是 append-only 无上限文件，为一个比较符整读不成立
  // 计数去向：豁免（harness#100）——本消费面只输出「够不够」的提示行，没有可挂坏行计数的输出位
  const { records, skippedLines } = readJsonl<ExecutionTrace>(tracesPath, 'skip', {
    head: TRACE_HINT_THRESHOLD,
  });
  const traceCount = records.length + skippedLines;
  if (traceCount === 0) {
    return null;
  }
  // 读取状态（经接缝；文件缺失 → {}）
  const state = stateIO.read();
  state.shownHints = state.shownHints || [];

  const hints: string[] = [];

  // 条件 1: 记录数首次达到阈值
  if (traceCount >= TRACE_HINT_THRESHOLD && !state.shownHints.includes('trace_50')) {
    hints.push('📊 记录已足够，运行 harness status 查看统计');
    state.shownHints.push('trace_50');
  }

  // 保存状态
  if (hints.length > 0) {
    stateIO.write(state);
    return hints.join('\n');
  }

  return null;
}

/**
 * 列出所有约束（按 severity 分组）
 */
/** optionRoutes 一律以 (options) 调用；--list 不消费检查选项，形参仅占位 */
export function listLaws(_options: Partial<CheckOptions> = {}, io: CommandIO = processIO): CommandResult {
  log(io, chalk.blue('\n📜 所有约束:\n'));

  const groups: Array<{ severity: 'error' | 'warning'; heading: string; paint: (s: string) => string }> = [
    { severity: 'error', heading: '🔴 error 级 - 违规即阻断，无例外:', paint: chalk.red },
    { severity: 'warning', heading: '🟡 warning 级 - 违规发警告但不阻止:', paint: chalk.yellow },
  ];
  for (const group of groups) {
    log(io, group.paint(group.heading + '\n'));
    Object.values(CONSTRAINTS)
      .filter(c => c.severity === group.severity)
      .forEach(constraint => {
        log(io, group.paint(`  ${constraint.id}`));
        log(io, chalk.gray(`    ${constraint.rule}`));
        log(io, chalk.gray(`    ${constraint.message}`));
        log(io);
      });
  }
  return { kind: 'ok' };
}
