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
export async function status(options: StatusOptions): Promise<void> {
  const projectPath = options.projectPath || process.cwd();
  const harnessDir = path.join(projectPath, '.harness');
  const tracesPath = path.join(harnessDir, 'traces', 'execution.log');
  const statePath = path.join(harnessDir, '.state.json');

  console.log(chalk.blue('📊 Harness 状态'));
  console.log();

  // 检查是否初始化
  if (!fs.existsSync(harnessDir)) {
    console.log(chalk.yellow('⚠️  未初始化'));
    console.log(chalk.gray('💡 运行 harness init 初始化项目'));
    return;
  }

  // 检查 trace 文件
  if (!fs.existsSync(tracesPath)) {
    console.log(chalk.yellow('⚠️  暂无 Trace 记录'));
    console.log(chalk.gray('💡 运行 harness check 开始记录'));
    return;
  }

  // 读取 trace 文件
  const tracesContent = fs.readFileSync(tracesPath, 'utf-8');
  const lines = tracesContent.trim().split('\n').filter(Boolean);
  const traceCount = lines.length;

  // 解析 traces
  const traces = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);

  // 创建收集器和分析器
  const collector = new TraceCollector({ traceFile: tracesPath });
  const analyzer = new TraceAnalyzer(collector);

  // 生成统计
  const summaries = analyzer.summarize(traces);
  const anomalies = analyzer.detectAnomalies(summaries);

  // 基本统计
  console.log(chalk.gray(`记录数: ${traceCount} 条`));
  console.log();

  if (options.anomalies) {
    // 只显示异常
    if (anomalies.length === 0) {
      console.log(chalk.green('✅ 未发现异常'));
    } else {
      console.log(chalk.yellow(`⚠️  发现 ${anomalies.length} 个异常:`));
      console.log();
      anomalies.forEach((a: any) => {
        console.log(chalk.yellow(`  ${a.constraintId}`));
        console.log(chalk.gray(`    类型: ${a.type}`));
        console.log(chalk.gray(`    当前值: ${a.current}`));
        console.log(chalk.gray(`    阈值: ${a.threshold}`));
        console.log();
      });

      // 下一步建议
      console.log(chalk.blue('💡 下一步建议:'));
      console.log(chalk.gray('  1. 运行 harness flow 一键诊断 + 提案'));
      console.log(chalk.gray('  2. 运行 harness status --detail 查看详情'));
    }
    return;
  }

  // 显示约束统计
  console.log(chalk.blue('📈 约束统计:'));
  console.log();

  // Iron Laws
  const ironLawSummaries = summaries.filter((s: any) => s.level === 'iron_law');
  if (ironLawSummaries.length > 0) {
    console.log(chalk.red('🔴 Iron Laws:'));
    ironLawSummaries.forEach((s: any) => {
      const status = s.passRate >= 1 ? '✅' : '❌';
      console.log(`  ${status} ${s.constraintId}`);
      if (options.detail) {
        console.log(chalk.gray(`     检查: ${s.totalChecks} | 通过: ${(s.passRate * 100).toFixed(0)}% | 绕过: ${(s.bypassRate * 100).toFixed(0)}%`));
      }
    });
    console.log();
  }

  // Guidelines
  const guidelineSummaries = summaries.filter((s: any) => s.level === 'guideline');
  if (guidelineSummaries.length > 0) {
    console.log(chalk.yellow('🟡 Guidelines:'));
    guidelineSummaries.forEach((s: any) => {
      const status = s.passRate >= 0.8 ? '✅' : s.passRate >= 0.5 ? '⚠️' : '❌';
      console.log(`  ${status} ${s.constraintId}`);
      if (options.detail) {
        console.log(chalk.gray(`     检查: ${s.totalChecks} | 通过: ${(s.passRate * 100).toFixed(0)}% | 绕过: ${(s.bypassRate * 100).toFixed(0)}%`));
      }
    });
    console.log();
  }

  // Tips
  const tipSummaries = summaries.filter((s: any) => s.level === 'tip');
  if (tipSummaries.length > 0) {
    console.log(chalk.blue('🔵 Tips:'));
    tipSummaries.forEach((s: any) => {
      console.log(`  💡 ${s.constraintId}`);
    });
    console.log();
  }

  // 异常检测
  if (anomalies.length > 0) {
    console.log(chalk.yellow(`⚠️  发现 ${anomalies.length} 个异常`));
    console.log();
    anomalies.slice(0, 3).forEach((a: any) => {
      console.log(chalk.yellow(`  - ${a.constraintId}: ${a.type}`));
    });
    console.log();
  }

  // 更新状态文件
  const state = {
    lastStatusRun: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // 下一步建议
  console.log(chalk.blue('💡 下一步建议:'));
  if (anomalies.length > 0) {
    console.log(chalk.gray('  harness flow            # 一键执行诊断+提案'));
    console.log(chalk.gray('  harness status --detail # 查看详细状态'));
  } else if (traceCount >= 100) {
    console.log(chalk.gray('  • 状态良好，继续保持！'));
  } else {
    console.log(chalk.gray('  • 继续积累数据，记录越多分析越准确'));
  }
}
