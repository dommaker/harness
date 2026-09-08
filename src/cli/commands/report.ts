/**
 * harness report 命令
 *
 * 生成检查报告（接入真实约束检查数据）
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { ConstraintChecker } from '../../core/constraints/checker';
import { IRON_LAWS, GUIDELINES, PROMPTS } from '../../core/constraints/definitions';
import { getTraceCollector } from '../../monitoring/traces';
import type { ConstraintContext } from '../../types/constraint';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ReportOptions {
  /** 输出文件路径 */
  output?: string;
  /** 输出格式 */
  format: 'json' | 'markdown';
  /** 项目路径 */
  projectPath?: string;
}

interface ReportData {
  timestamp: string;
  projectPath: string;
  constraints: {
    total: number;
    ironLaws: number;
    guidelines: number;
    prompts: number;
    passed: number;
    failed: number;
    warnings: number;
    violations: Array<{
      id: string;
      level: string;
      message: string;
    }>;
  };
}

/**
 * 生成检查报告
 */
export async function report(options: ReportOptions, io: CommandIO = processIO): Promise<CommandResult> {
  log(io, chalk.blue('📊 生成检查报告...'));

  const projectPath = options.projectPath || process.cwd();
  // trace 记录器经构造参数接线（harness#88）：本命令是组合根
  const checker = new ConstraintChecker(getTraceCollector());

  const allConstraints = { ...IRON_LAWS, ...GUIDELINES, ...PROMPTS };
  const totalConstraints = Object.keys(allConstraints).length;

  const context: ConstraintContext = {
    operation: 'file_modification',
    projectPath,
  };

  // 收集模式（架构评审候选1）：不抛、全量收集，铁律违规如实进报告
  const result = await checker.collectConstraints(context);

  const failedIronLaws = result.ironLaws.filter(r => !r.satisfied);
  const failedGuidelines = result.guidelines.filter(r => !r.satisfied);

  const violations = [...failedIronLaws, ...failedGuidelines].map(r => ({
    id: r.id,
    level: r.level,
    message: r.message || '',
  }));

  const reportData: ReportData = {
    timestamp: new Date().toISOString(),
    projectPath,
    constraints: {
      total: totalConstraints,
      ironLaws: Object.keys(IRON_LAWS).length,
      guidelines: Object.keys(GUIDELINES).length,
      prompts: Object.keys(PROMPTS).length,
      passed: result.passed ? totalConstraints : totalConstraints - violations.length,
      failed: failedIronLaws.length,
      warnings: failedGuidelines.length,
      violations,
    },
  };

  let content: string;

  switch (options.format) {
    case 'json':
      content = JSON.stringify(reportData, null, 2);
      break;
    case 'markdown':
      content = generateMarkdownReport(reportData);
      break;
    default:
      content = JSON.stringify(reportData, null, 2);
  }

  if (options.output) {
    await fs.writeFile(options.output, content, 'utf-8');
    log(io, chalk.green(`✅ 报告已保存到: ${options.output}`));
  } else {
    log(io, content);
  }
  return { kind: 'ok' };
}

function generateMarkdownReport(data: ReportData): string {
  const lines: string[] = [
    `# Harness 检查报告`,
    ``,
    `> 生成时间: ${data.timestamp}`,
    `> 项目路径: ${data.projectPath}`,
    ``,
    `---`,
    ``,
    `## 约束检查`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 总约束 | ${data.constraints.total} |`,
    `| Iron Laws | ${data.constraints.ironLaws} |`,
    `| Guidelines | ${data.constraints.guidelines} |`,
    `| Prompts | ${data.constraints.prompts} |`,
    `| 通过 | ${data.constraints.passed} |`,
    `| 失败 (error) | ${data.constraints.failed} |`,
    `| 警告 (warning) | ${data.constraints.warnings} |`,
    ``,
  ];

  if (data.constraints.violations.length > 0) {
    lines.push(`### 违规项`, ``);
    data.constraints.violations.forEach(v => {
      lines.push(`- **${v.id}** (${v.level}): ${v.message}`);
    });
    lines.push(``);
  }

  lines.push(`---`, `*报告由 @dommaker/harness 生成*`, ``);
  return lines.join('\n');
}

