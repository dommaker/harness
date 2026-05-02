/**
 * harness flow 命令
 *
 * 一键执行诊断 + 提案流程
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { TraceCollector } from '../../monitoring/traces';
import { TraceAnalyzer } from '../../monitoring/trace-analyzer';
import { ConstraintDoctor, Diagnosis } from '../../monitoring/constraint-doctor';
import { ConstraintEvolver, ConstraintProposal } from '../../monitoring/constraint-evolver';
import { ConstraintLifecycleRunner, type ExecutionResult } from '../../constraints/lifecycle-runner';
import type { TraceAnomaly } from '../../types/trace';

export interface FlowOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 从哪个步骤开始 */
  from?: 'analyze' | 'diagnose' | 'propose';
  /** 自动应用低风险提案 */
  autoApply?: boolean;
  /** 自动执行已接受的提案（调用 ConstraintLifecycleRunner） */
  autoExecute?: boolean;
  /** 时间范围（小时） */
  hours?: number;
}

/**
 * 创建 readline 接口
 */
function createReadlineInterface(): readline.ReadLine {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 询问用户
 */
function ask(rl: readline.ReadLine, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * 执行流程
 */
export async function flow(options: FlowOptions): Promise<void> {
  const projectPath = options.projectPath || process.cwd();
  const harnessDir = path.join(projectPath, '.harness');
  const tracesPath = path.join(harnessDir, 'traces', 'execution.log');
  const diagnosesDir = path.join(harnessDir, 'diagnoses');
  const proposalsDir = path.join(harnessDir, 'proposals');

  console.log(chalk.blue('🔄 Harness 自动化流程'));
  console.log();

  // 检查前置条件
  if (!fs.existsSync(tracesPath)) {
    console.log(chalk.yellow('⚠️  暂无 Trace 记录'));
    console.log(chalk.gray('💡 运行 harness check 开始记录'));
    return;
  }

  // 读取 traces
  const tracesContent = fs.readFileSync(tracesPath, 'utf-8');
  const lines = tracesContent.trim().split('\n').filter(Boolean);
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
  const summaries = analyzer.summarize(traces);
  let anomalies = analyzer.detectAnomalies(summaries);

  const rl = createReadlineInterface();

  try {
    // 步骤 1: 分析统计
    if (!options.from || options.from === 'analyze') {
      console.log(chalk.blue('📊 步骤 1/4: 分析统计'));
      console.log(chalk.gray('────────────────────────────'));

      console.log(chalk.gray(`约束统计: ${summaries.length} 条`));
      console.log(chalk.gray(`检测异常: ${anomalies.length} 个`));

      if (anomalies.length === 0) {
        console.log(chalk.green('✅ 未发现异常'));
        rl.close();
        return;
      }

      console.log(chalk.yellow('发现异常:'));
      anomalies.forEach((a: TraceAnomaly) => {
        console.log(chalk.yellow(`  - ${a.constraintId}: ${a.type}`));
      });
      console.log();

      // 询问是否继续
      const continue1 = await ask(rl, '是否继续运行诊断？ [Y/n] ');
      if (continue1 === 'n') {
        console.log(chalk.gray('已取消'));
        rl.close();
        return;
      }
      console.log();
    }

    // 步骤 2: 运行诊断
    console.log(chalk.blue('🔍 步骤 2/4: 运行诊断'));
    console.log(chalk.gray('────────────────────────────'));

    const doctor = new ConstraintDoctor();
    const diagnoses: Diagnosis[] = [];

    for (const anomaly of anomalies) {
      try {
        const diagnosis = await doctor.diagnose(anomaly);
        diagnoses.push(diagnosis);
      } catch (e) {
        console.log(chalk.yellow(`  ⚠️ ${anomaly.constraintId} 诊断失败`));
      }
    }

    console.log(chalk.gray(`诊断数量: ${diagnoses.length}`));

    if (diagnoses.length > 0) {
      console.log();
      diagnoses.forEach((d: Diagnosis) => {
        console.log(chalk.yellow(`  ${d.constraintId}`));
        console.log(chalk.gray(`    根因: ${d.rootCause.primary}`));
        console.log(chalk.gray(`    严重度: ${d.impact.severity}`));
      });
    }

    // 保存诊断结果
    if (diagnoses.length > 0) {
      fs.mkdirSync(diagnosesDir, { recursive: true });
      const diagnosisFile = path.join(diagnosesDir, `${new Date().toISOString().split('T')[0]}.json`);
      fs.writeFileSync(diagnosisFile, JSON.stringify(diagnoses, null, 2));
      console.log(chalk.green(`✅ 诊断已保存: ${diagnosisFile}`));
    }
    console.log();

    // 询问是否继续
    const continue2 = await ask(rl, '是否继续生成优化提案？ [Y/n] ');
    if (continue2 === 'n') {
      console.log(chalk.gray('已取消'));
      rl.close();
      return;
    }
    console.log();

    // 步骤 3: 生成提案
    console.log(chalk.blue('💡 步骤 3/4: 生成提案'));
    console.log(chalk.gray('────────────────────────────'));

    const evolver = new ConstraintEvolver();
    const proposals: ConstraintProposal[] = [];

    for (const diagnosis of diagnoses) {
      try {
        const proposal = await evolver.propose(diagnosis);
        if (proposal) {
          proposals.push(proposal);
        }
      } catch (e) {
        console.log(chalk.yellow(`  ⚠️ ${diagnosis.constraintId} 提案生成失败`));
      }
    }

    console.log(chalk.gray(`提案数量: ${proposals.length}`));

    if (proposals.length === 0) {
      console.log(chalk.green('✅ 无需优化'));
      rl.close();
      return;
    }

    console.log();
    proposals.forEach((p: ConstraintProposal, i: number) => {
      console.log(chalk.yellow(`提案 ${i + 1}:`));
      console.log(chalk.gray(`  约束: ${p.constraintId}`));
      console.log(chalk.gray(`  操作: ${p.type}`));
      console.log(chalk.gray(`  风险: ${p.risk.level}`));
      console.log();
    });

    // 保存提案
    fs.mkdirSync(proposalsDir, { recursive: true });
    const proposalFile = path.join(proposalsDir, `${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(proposalFile, JSON.stringify({ proposals, timestamp: new Date().toISOString() }, null, 2));
    console.log(chalk.green(`✅ 提案已保存: ${proposalFile}`));
    console.log();

    // 步骤 4: 审核提案
    console.log(chalk.blue('📝 步骤 4/4: 审核提案'));
    console.log(chalk.gray('────────────────────────────'));

    const runner = options.autoExecute ? new ConstraintLifecycleRunner() : null;
    const executionResults: ExecutionResult[] = [];

    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];

      // 低风险 → 可自动应用
      if (options.autoApply && p.risk.level === 'low') {
        console.log(chalk.green(`✅ 自动应用提案 ${i + 1} (低风险)`));
        if (runner) {
          const result = runner.execute(p);
          executionResults.push(result);
          if (result.success) {
            console.log(chalk.green(`  ✅ 已执行: ${result.details}`));
          } else {
            console.log(chalk.yellow(`  ⚠️ 执行失败: ${result.details}`));
          }
        }
        continue;
      }

      // 需要人工审核
      const answer = await ask(rl, `是否应用提案 ${i + 1}？ [y/N] `);
      if (answer === 'y') {
        console.log(chalk.green(`✅ 提案 ${i + 1} 已标记为应用`));
        if (runner) {
          const result = runner.execute(p);
          executionResults.push(result);
          if (result.success) {
            console.log(chalk.green(`  ✅ 已执行: ${result.details}`));
          } else {
            console.log(chalk.yellow(`  ⚠️ 执行失败: ${result.details}`));
          }
        } else {
          console.log(chalk.gray('  请手动更新约束配置'));
        }
      } else {
        console.log(chalk.gray(`⏭️  跳过提案 ${i + 1}`));
      }
    }

    // 显示执行摘要
    if (executionResults.length > 0) {
      console.log();
      console.log(chalk.blue('📊 执行摘要:'));
      const succeeded = executionResults.filter(r => r.success).length;
      const failed = executionResults.filter(r => !r.success).length;
      console.log(chalk.gray(`  成功: ${succeeded}, 失败: ${failed}`));
    }

    console.log();
    console.log(chalk.green('✅ 流程完成！'));
    console.log();
    console.log(chalk.blue('💡 下一步:'));
    console.log(chalk.gray('  1. 查看提案文件确认变更'));
    if (!runner) {
      console.log(chalk.gray('  2. 手动更新约束配置'));
    }
    console.log(chalk.gray(`  ${runner ? '2' : '3'}. 运行 harness status 查看效果`));
  } finally {
    rl.close();
  }
}
