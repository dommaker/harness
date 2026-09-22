/**
 * harness report 命令
 *
 * 生成检查报告（接入真实约束检查数据）
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { ConstraintChecker } from '../../core/constraints/checker';
import { getMergedConstraintsConfig } from '../../core/effective-constraints';
import { TraceCollector } from '../../monitoring/traces';
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
    errors: number;
    warnings: number;
    passed: number;
    failed: number;
    warningViolations: number;
    violations: Array<{
      id: string;
      severity: string;
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
  // #139：收集器锚根构造——不传 projectPath 时 trace 会落进调用方 cwd，B 侧读不到
  const checker = new ConstraintChecker(new TraceCollector({ projectPath }));

  // 生效集口径与 check.ts 同一入口（ADR-0033：应用层约束进 report 面的前提）——
  // 此前跑的是内置全集（CONSTRAINTS），config.yml 禁用与应用层条目都不进报告
  const merged = getMergedConstraintsConfig(projectPath);
  const effectiveConstraints = Object.values(merged.constraints);
  const totalConstraints = effectiveConstraints.length;

  const context: ConstraintContext = {
    operation: 'file_modification',
    projectPath,
  };

  // 收集模式（架构评审候选1）：不抛、全量收集，error 级违规如实进报告
  const result = await checker.collectConstraints(context, merged);

  const failedErrors = result.errors.filter(r => !r.satisfied);
  const failedWarnings = result.warnings.filter(r => !r.satisfied);

  const violations = [...failedErrors, ...failedWarnings].map(r => ({
    id: r.id,
    severity: r.severity,
    message: r.message || '',
  }));

  const reportData: ReportData = {
    timestamp: new Date().toISOString(),
    projectPath,
    constraints: {
      total: totalConstraints,
      errors: effectiveConstraints.filter(c => c.severity === 'error').length,
      warnings: effectiveConstraints.filter(c => c.severity === 'warning').length,
      passed: result.passed ? totalConstraints : totalConstraints - violations.length,
      failed: failedErrors.length,
      warningViolations: failedWarnings.length,
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
    `| error 级 | ${data.constraints.errors} |`,
    `| warning 级 | ${data.constraints.warnings} |`,
    `| 通过 | ${data.constraints.passed} |`,
    `| 失败 (error) | ${data.constraints.failed} |`,
    `| 警告 (warning) | ${data.constraints.warningViolations} |`,
    ``,
  ];

  if (data.constraints.violations.length > 0) {
    lines.push(`### 违规项`, ``);
    data.constraints.violations.forEach(v => {
      lines.push(`- **${v.id}** (${v.severity}): ${v.message}`);
    });
    lines.push(``);
  }

  lines.push(`---`, `*报告由 @dommaker/harness 生成*`, ``);
  return lines.join('\n');
}

