/**
 * harness report 命令
 *
 * 生成检查报告（接入真实约束检查数据）
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { assembleConstraintChecker } from '../../bootstrap';
import { getMergedConstraintsConfig } from '../../core/effective-constraints';
import {
  createCommandExecutionPolicy,
  formatCommandPlan,
  planCommandsFromConstraints,
} from '../../core/command-execution-policy';
import type { ConstraintContext } from '../../types/constraint';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ReportOptions {
  /** 输出文件路径 */
  output?: string;
  /** 输出格式 */
  format: 'json' | 'markdown';
  /** 项目路径 */
  projectPath?: string;
  /** 只读模式（CLI --read-only；D3 P0.5 Phase 1）：跳过项目 YAML 声明的命令执行 */
  readOnly?: boolean;
}

interface ReportData {
  timestamp: string;
  projectPath: string;
  constraints: {
    total: number;
    errors: number;
    warnings: number;
    passed: number;
    /** 失败 error 级条数 */
    failed: number;
    warningViolations: number;
    /**
     * 未评估条数（D3 read-only 新增；普通模式缺席，保持既有 JSON 形状）
     *
     * read-only 下 = 声明命令未执行的三态 skipped 数；假绿防线——此时 passed 已扣除未评估。
     */
    skipped?: number;
    /** 未评估明细（D3 read-only 新增；普通模式缺席） */
    skippedConstraints?: Array<{
      id: string;
      skipReason?: string;
    }>;
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
  // checker 经唯一装配函数取（P1.1）：trace 接线只写一次，收集器锚根构造
  // （#139：不传 projectPath 时 trace 会落进调用方 cwd，B 侧读不到）
  // commandPolicy（D3）：本 run 的统一执行策略，read-only 下 exec 模板 checker
  // 三态跳过声明命令；缺省 = 默认执行
  const policy = createCommandExecutionPolicy({ readOnly: options.readOnly });
  const checker = assembleConstraintChecker(projectPath, policy);

  // 生效集口径与 check.ts 同一入口（ADR-0033：应用层约束进 report 面的前提）——
  // 此前跑的是内置全集（CONSTRAINTS），config.yml 禁用与应用层条目都不进报告
  const merged = getMergedConstraintsConfig(projectPath);
  const effectiveConstraints = Object.values(merged.constraints);
  const totalConstraints = effectiveConstraints.length;

  const context: ConstraintContext = {
    operation: 'file_modification',
    projectPath,
  };

  // 运行前清单（D3 P0.5 Phase 1）：列出本次将执行的项目声明命令；--read-only 下列出被跳过的。
  // 清单按 context 的 operation/extraTriggers 过滤（与 checker 分发同口径）。
  const commandPlan = planCommandsFromConstraints(merged.constraints, context);
  if (commandPlan.length > 0) {
    if (options.readOnly) {
      log(io, chalk.gray(`⏭️ --read-only：跳过 ${commandPlan.length} 条项目声明命令（未执行）:`));
    } else {
      log(io, chalk.yellow(`⚠️ 本次将执行 ${commandPlan.length} 条项目声明命令:`));
    }
    formatCommandPlan(commandPlan).forEach(line => log(io, chalk.gray(line)));
  }

  // 收集模式（架构评审候选1）：不抛、全量收集，error 级违规如实进报告
  const result = await checker.collectConstraints(context, merged);

  const failedErrors = result.errors.filter(r => !r.satisfied);
  const failedWarnings = result.warnings.filter(r => !r.satisfied);
  const skippedResults = [...result.errors, ...result.warnings].filter(r => r.skipped);

  const violations = [...failedErrors, ...failedWarnings].map(r => ({
    id: r.id,
    severity: r.severity,
    message: r.message || '',
  }));

  // 普通模式：字段集合与 passed 公式逐字保持既有形状（本票契约）。
  // 仅 --read-only 添加 skipped/skippedConstraints，且 passed 不把未评估计成通过（假绿防线）。
  const reportData: ReportData = {
    timestamp: new Date().toISOString(),
    projectPath,
    constraints: {
      total: totalConstraints,
      errors: effectiveConstraints.filter(c => c.severity === 'error').length,
      warnings: effectiveConstraints.filter(c => c.severity === 'warning').length,
      passed: options.readOnly
        ? (result.passed ? totalConstraints : totalConstraints - violations.length) - skippedResults.length
        : result.passed ? totalConstraints : totalConstraints - violations.length,
      failed: failedErrors.length,
      warningViolations: failedWarnings.length,
      ...(options.readOnly
        ? {
            skipped: skippedResults.length,
            skippedConstraints: skippedResults.map(r => ({ id: r.id, skipReason: r.skipReason })),
          }
        : {}),
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

  // read-only 且本 run 有声明命令被策略跳过：返回 skip（退出 0）而非 ok——
  // 上层不能把「命令未执行」的报告当完整验证结果
  if (options.readOnly) {
    const planSources = new Set(commandPlan.map(p => p.source));
    const policySkipped = skippedResults.filter(r => planSources.has(r.id));
    if (policySkipped.length > 0) {
      return {
        kind: 'skip',
        reason: `--read-only: ${policySkipped.length} constraints not evaluated (commands not executed)`,
      };
    }
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
    // 跳过行只随 --read-only 出现（普通模式行集合保持既有形状）
    ...(data.constraints.skipped !== undefined ? [`| 跳过（未评估） | ${data.constraints.skipped} |`] : []),
    ``,
  ];

  if (data.constraints.violations.length > 0) {
    lines.push(`### 违规项`, ``);
    data.constraints.violations.forEach(v => {
      lines.push(`- **${v.id}** (${v.severity}): ${v.message}`);
    });
    lines.push(``);
  }

  const skippedConstraints = data.constraints.skippedConstraints;
  if (skippedConstraints && skippedConstraints.length > 0) {
    lines.push(`### 跳过项`, ``);
    skippedConstraints.forEach(s => {
      lines.push(`- **${s.id}**: ${s.skipReason ?? '未评估'}`);
    });
    lines.push(``);
  }

  lines.push(`---`, `*报告由 @dommaker/harness 生成*`, ``);
  return lines.join('\n');
}

