/**
 * harness status 命令
 *
 * 显示 Harness 状态、统计、异常检测 + 智能建议
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { TraceCollector } from '../../monitoring/traces';
import { TraceAnalyzer } from '../../monitoring/trace-analyzer';
import { readJsonl } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
import type { ExecutionTrace } from '../../types/trace';
import type { TraceSummary, TraceAnomaly } from '../../types/trace';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface StatusOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 详细模式 */
  detail?: boolean;
  /** 只显示异常 */
  anomalies?: boolean;
  /** 时间范围（小时） */
  hours?: number;
}

/**
 * 显示 Harness 状态
 */
export async function status(options: StatusOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const projectPath = options.projectPath || process.cwd();
  const harnessDir = path.join(projectPath, '.harness');
  const tracesPath = path.join(projectPath, DEFAULT_TRACE_FILE);
  const statePath = path.join(harnessDir, '.state.json');

  log(io, chalk.blue('📊 Harness 状态'));
  log(io);

  // 检查是否初始化
  if (!fs.existsSync(harnessDir)) {
    log(io, chalk.yellow('⚠️  未初始化'));
    log(io, chalk.gray('💡 运行 harness init 初始化项目'));
    return { kind: 'ok' };
  }

  // 检查 trace 文件
  if (!fs.existsSync(tracesPath)) {
    log(io, chalk.yellow('⚠️  暂无 Trace 记录'));
    log(io, chalk.gray('💡 运行 harness check 开始记录'));
    return { kind: 'ok' };
  }

  // 读取 trace 文件：坏行策略 skip（原 null + filter(Boolean) 语义不变，harness#82）
  // traceCount 保持原始非空行数口径（合法 + 跳过），与改前显示逐字节一致；
  // filter(Boolean) 沿用原语义：parse 成功但值为 falsy 的行（如 "null"）不进分析
  // 计数去向：harness#100——skippedLines 另起一行走 stderr 告知（口径不改，只补告知）。
  // 不经 TraceCollector.readReport()：本命令按 -p 的 projectPath 直读读链正本，且要的是
  // records + skippedLines 的原始行数口径；下面另建的 collector/analyzer 只用于 summarize/detectAnomalies
  const { records, skippedLines } = readJsonl<ExecutionTrace>(tracesPath, 'skip');
  const traces = records.filter(Boolean);
  const traceCount = records.length + skippedLines;

  // 创建收集器和分析器
  const collector = new TraceCollector({ traceFile: tracesPath });
  const analyzer = new TraceAnalyzer(collector);

  // 生成统计
  const summaries = analyzer.summarize(traces);
  const anomalies = analyzer.detectAnomalies(summaries);

  // 基本统计
  log(io, chalk.gray(`记录数: ${traceCount} 条`));
  log(io);

  // 数据不完整必须让看报告的人知道（harness#100）：诊断信息走 stderr，
  // stdout 报告体口径与字节不变；无损坏零噪声
  if (skippedLines > 0) {
    logError(io, `⚠️  trace 文件有 ${skippedLines} 行损坏已跳过，上述记录数含坏行，统计只基于其余合法记录`);
  }

  if (options.anomalies) {
    // 只显示异常
    if (anomalies.length === 0) {
      log(io, chalk.green('✅ 未发现异常'));
    } else {
      log(io, chalk.yellow(`⚠️  发现 ${anomalies.length} 个异常:`));
      log(io);
      anomalies.forEach((a: TraceAnomaly) => {
        log(io, chalk.yellow(`  ${a.constraintId}`));
        log(io, chalk.gray(`    类型: ${a.type}`));
        log(io, chalk.gray(`    当前值: ${a.data?.currentRate ?? (a as any).current ?? 'N/A'}`));
        log(io, chalk.gray(`    阈值: ${a.data?.threshold ?? (a as any).threshold ?? 'N/A'}`));
        log(io);
      });

      // 下一步建议
      log(io, chalk.blue('💡 下一步建议:'));
      log(io, chalk.gray('  运行 harness status --detail 查看详情'));
    }
    return { kind: 'ok' };
  }

  // 显示约束统计
  log(io, chalk.blue('📈 约束统计:'));
  log(io);

  // Iron Laws
  const ironLawSummaries = summaries.filter((s: TraceSummary) => s.level === 'iron_law');
  if (ironLawSummaries.length > 0) {
    log(io, chalk.red('🔴 Iron Laws:'));
    ironLawSummaries.forEach((s: TraceSummary) => {
      const status = s.passRate >= 1 ? '✅' : '❌';
      log(io, `  ${status} ${s.constraintId}`);
      if (options.detail) {
        log(io, chalk.gray(`     检查: ${s.totalChecks} | 通过: ${(s.passRate * 100).toFixed(0)}% | 失败: ${(s.failRate * 100).toFixed(0)}%`));
      }
    });
    log(io);
  }

  // Guidelines
  const guidelineSummaries = summaries.filter((s: TraceSummary) => s.level === 'guideline');
  if (guidelineSummaries.length > 0) {
    log(io, chalk.yellow('🟡 Guidelines:'));
    guidelineSummaries.forEach((s: TraceSummary) => {
      const status = s.passRate >= 0.8 ? '✅' : s.passRate >= 0.5 ? '⚠️' : '❌';
      log(io, `  ${status} ${s.constraintId}`);
      if (options.detail) {
        log(io, chalk.gray(`     检查: ${s.totalChecks} | 通过: ${(s.passRate * 100).toFixed(0)}% | 失败: ${(s.failRate * 100).toFixed(0)}%`));
      }
    });
    log(io);
  }

  // 异常检测
  if (anomalies.length > 0) {
    log(io, chalk.yellow(`⚠️  发现 ${anomalies.length} 个异常`));
    log(io);
    anomalies.slice(0, 3).forEach((a: TraceAnomaly) => {
      log(io, chalk.yellow(`  - ${a.constraintId}: ${a.type}`));
    });
    log(io);
  }

  // 更新状态文件
  const state = {
    lastStatusRun: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // 下一步建议
  log(io, chalk.blue('💡 下一步建议:'));
  if (anomalies.length > 0) {
    log(io, chalk.gray('  harness status --detail # 查看详细状态'));
  } else if (traceCount >= 100) {
    log(io, chalk.gray('  • 状态良好，继续保持！'));
  } else {
    log(io, chalk.gray('  • 继续积累数据，记录越多分析越准确'));
  }
  return { kind: 'ok' };
}
