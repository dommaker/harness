/**
 * harness report 命令
 *
 * 生成检查报告（接入真实约束检查数据）
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { ConstraintChecker } from '../../core/constraints/checker';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../core/constraints/definitions';
import { executeWithCollect } from '../../failure/constraint-handler';
import type { ConstraintContext } from '../../types/constraint';

export interface ReportOptions {
  /** 输出文件路径 */
  output?: string;
  /** 输出格式 */
  format: 'json' | 'markdown' | 'html';
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
    tips: number;
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
export async function report(options: ReportOptions): Promise<void> {
  console.log(chalk.blue('📊 生成检查报告...'));

  const projectPath = options.projectPath || process.cwd();
  const checker = ConstraintChecker.getInstance();

  const allConstraints = { ...IRON_LAWS, ...GUIDELINES, ...TIPS };
  const totalConstraints = Object.keys(allConstraints).length;

  const context: ConstraintContext = {
    operation: 'file_modification',
    projectPath,
  };

  // S4: 使用 COLLECT 策略 — Iron Law 违规不抛异常，收集到结果中
  const { checkResult } = await executeWithCollect(() =>
    checker.checkConstraints(context)
  );
  // COLLECT 策略始终返回 checkResult
  const result = checkResult!;

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
      tips: Object.keys(TIPS).length,
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
    case 'html':
      content = generateHtmlReport(reportData);
      break;
    default:
      content = JSON.stringify(reportData, null, 2);
  }

  if (options.output) {
    await fs.writeFile(options.output, content, 'utf-8');
    console.log(chalk.green(`✅ 报告已保存到: ${options.output}`));
  } else {
    console.log(content);
  }
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
    `| Tips | ${data.constraints.tips} |`,
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

function generateHtmlReport(data: ReportData): string {
  const violationsHtml = data.constraints.violations.length > 0
    ? `<h3>违规项</h3><ul>${data.constraints.violations.map(v =>
        `<li><strong>${v.id}</strong> (${v.level}): ${v.message}</li>`
      ).join('')}</ul>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Harness 检查报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .passed { color: #4CAF50; }
    .failed { color: #f44336; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>Harness 检查报告</h1>
  <p class="meta">生成时间: ${data.timestamp}<br>项目路径: ${data.projectPath}</p>

  <h2>约束检查</h2>
  <table>
    <tr><th>指标</th><th>数值</th></tr>
    <tr><td>总约束</td><td>${data.constraints.total}</td></tr>
    <tr><td>Iron Laws</td><td>${data.constraints.ironLaws}</td></tr>
    <tr><td>Guidelines</td><td>${data.constraints.guidelines}</td></tr>
    <tr><td>Tips</td><td>${data.constraints.tips}</td></tr>
    <tr><td>通过</td><td class="passed">${data.constraints.passed}</td></tr>
    <tr><td>失败</td><td class="failed">${data.constraints.failed}</td></tr>
    <tr><td>警告</td><td>${data.constraints.warnings}</td></tr>
  </table>

  ${violationsHtml}

  <footer style="margin-top: 40px; color: #999; text-align: center;">
    报告由 @dommaker/harness 生成
  </footer>
</body>
</html>`;
}
