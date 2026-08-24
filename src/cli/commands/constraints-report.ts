/**
 * harness constraints report —— 约束使用报告（ADR-0001 决策 3/4）
 *
 * 只读。面向"人审约束"场景：
 * - check 层统计表（total/pass/fail/skip、fail 率、首次/最近触发）
 * - 退役候选诊断（零触发/零拦截/不可评估/高噪），retire 交互模式的数据源
 * - 当前生效 prompt 注入清单
 * - 配置健康（unknownIds 残留提示）
 * - --export [file]：脱敏 markdown 摘要（不含项目路径）
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  buildConstraintsUsageReport,
  DEFAULT_DIAGNOSE_THRESHOLDS,
  type ConstraintsUsageReport,
  type ConstraintUsageStats,
  type DiagnoseThresholds,
  type RetireCandidate,
} from '../../core/constraints/usage-report';
import { getConstraintsMeta } from './constraints';
import { detectInjectionDrift, type InjectionDrift } from '../../core/constraints/injection-drift';

export interface ConstraintsReportOptions {
  projectPath?: string;
  /** --export [file]：true = 默认路径；string = 指定文件 */
  export?: boolean | string;
  json?: boolean;
  /** 零拦截候选的最小评估样本数 */
  zeroInterceptMin?: number;
  /** 高噪候选 fail 率阈值 */
  noiseFailRate?: number;
  /** 高噪候选最小评估样本数 */
  noiseMinTotal?: number;
}

const CANDIDATE_KIND_LABEL: Record<RetireCandidate['kind'], string> = {
  zero_trigger: '零触发',
  unevaluable: '不可评估',
  high_noise: '高噪',
  zero_intercept: '零拦截',
};

function formatTime(ts: number | undefined): string {
  return ts === undefined ? '-' : new Date(ts).toISOString().slice(0, 10);
}

function formatPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * 渲染统计表（纯文本行，供 console 与 export 共用单行内容）
 */
function renderStatsRow(s: ConstraintUsageStats): string {
  return `${s.id}  total=${s.total} pass=${s.pass} fail=${s.fail} skip=${s.skip} fail率=${formatPct(s.failRate)} 首次=${formatTime(s.firstAt)} 最近=${formatTime(s.lastAt)}`;
}

/**
 * 渲染脱敏 markdown 摘要（ADR-0001 决策 4）
 *
 * 脱敏约束：不含 projectPath 等本地敏感信息；
 * 内容为 harness 版本、日期、统计表、候选清单、配置健康。
 */
export function renderExportMarkdown(
  report: ConstraintsUsageReport,
  version: string,
  now: Date = new Date()
): string {
  const lines: string[] = [];
  lines.push('# Harness Constraints Report');
  lines.push('');
  lines.push(`- harness 版本: ${version}`);
  lines.push(`- 日期: ${now.toISOString().slice(0, 10)}`);
  lines.push('');

  lines.push('## 统计表（check 层）');
  lines.push('');
  lines.push('| id | total | pass | fail | skip | fail 率 | 首次触发 | 最近触发 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const s of report.stats) {
    lines.push(
      `| ${s.id} | ${s.total} | ${s.pass} | ${s.fail} | ${s.skip} | ${formatPct(s.failRate)} | ${formatTime(s.firstAt)} | ${formatTime(s.lastAt)} |`
    );
  }
  lines.push('');

  lines.push('## 退役候选');
  lines.push('');
  if (report.candidates.length === 0) {
    lines.push('（无候选）');
  } else {
    for (const c of report.candidates) {
      lines.push(`- [${CANDIDATE_KIND_LABEL[c.kind]}] \`${c.id}\` — ${c.reason}`);
    }
  }
  lines.push('');

  if (report.lint.unknownIds.length > 0) {
    lines.push('## 配置健康');
    lines.push('');
    for (const id of report.lint.unknownIds) {
      lines.push(`- config.yml 中禁用了不存在/已移除的约束 id: \`${id}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 渲染"注入漂移"小节的文本行（ADR-0001 决策 7：详细条目级差异进 report）
 *
 * 返回纯文本行数组（不含 chalk 着色），调用方逐行 console.log。
 */
export function renderInjectionDriftLines(drift: InjectionDrift): string[] {
  const lines: string[] = [];
  if (drift.notInjected) {
    lines.push('  CLAUDE.md / AGENTS.md 均无约束注入标记段（未注入，不算漂移）；可运行 npx @dommaker/harness init 注入');
    if (drift.duplicateHeading) {
      lines.push('  另检测到多个 "## Governance Rules" 标题（历史遗留重复章节），建议手工清理后重跑 npx @dommaker/harness init');
    }
    return lines;
  }
  if (!drift.hasDrift) {
    lines.push('  无漂移');
    return lines;
  }
  if (drift.versionDrift) {
    lines.push(`  版本漂移: 注入段版本 (${drift.versionDrift.actual}) ≠ 当前 harness 版本 (${drift.versionDrift.expected})`);
  }
  if (drift.contentDrift) {
    lines.push('  内容漂移（条目级差异）:');
    for (const l of drift.contentDrift.missing) {
      lines.push(`    缺失: ${l}`);
    }
    for (const l of drift.contentDrift.extra) {
      lines.push(`    多余: ${l}`);
    }
  }
  if (drift.duplicateHeading) {
    lines.push('  重复章节: 标记段之外还存在另一个 "## Governance Rules" 标题');
  }
  lines.push(`  修复: ${drift.fixHint}`);
  return lines;
}

/**
 * CLI handler: harness constraints report
 */
export async function constraintsReport(options: ConstraintsReportOptions = {}): Promise<void> {
  const projectRoot = options.projectPath || process.cwd();
  const thresholds: Partial<DiagnoseThresholds> = {};
  if (options.zeroInterceptMin !== undefined) thresholds.zeroInterceptMinEvaluated = options.zeroInterceptMin;
  if (options.noiseFailRate !== undefined) thresholds.highNoiseFailRate = options.noiseFailRate;
  if (options.noiseMinTotal !== undefined) thresholds.highNoiseMinEvaluated = options.noiseMinTotal;

  const report = buildConstraintsUsageReport(projectRoot, thresholds);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(chalk.blue('📊 约束使用报告'));
  if (!report.traceFileExists) {
    console.log(chalk.gray('   （trace 文件不存在，全部按零触发统计）'));
  }
  console.log();

  // 统计表
  console.log(chalk.bold('统计表（check 层）:'));
  for (const s of report.stats) {
    console.log(`  ${renderStatsRow(s)}`);
  }
  console.log();

  // 候选诊断
  console.log(chalk.bold(`退役候选（${report.candidates.length} 条，阈值: 零拦截≥${thresholds.zeroInterceptMinEvaluated ?? DEFAULT_DIAGNOSE_THRESHOLDS.zeroInterceptMinEvaluated} 次评估, 高噪 fail率>${Math.round((thresholds.highNoiseFailRate ?? DEFAULT_DIAGNOSE_THRESHOLDS.highNoiseFailRate) * 100)}% 且 ≥${thresholds.highNoiseMinEvaluated ?? DEFAULT_DIAGNOSE_THRESHOLDS.highNoiseMinEvaluated} 次评估）:`));
  if (report.candidates.length === 0) {
    console.log(chalk.green('  （无候选）'));
  } else {
    for (const c of report.candidates) {
      console.log(`  [${CANDIDATE_KIND_LABEL[c.kind]}] ${c.id} — ${c.reason}`);
    }
    console.log(chalk.gray('  可运行 `harness constraints retire` 交互式处理候选'));
  }
  console.log();

  // 注入清单
  console.log(chalk.bold(`当前生效 prompt 注入（${report.activePromptIds.length} 条）:`));
  for (const id of report.activePromptIds) {
    console.log(`  ${id}`);
  }
  console.log();

  // 配置健康
  if (report.lint.unknownIds.length > 0) {
    console.log(chalk.yellow('⚠️  配置健康:'));
    for (const id of report.lint.unknownIds) {
      console.log(chalk.yellow(`  config.yml 中禁用了不存在/已移除的约束 id: ${id}（残留配置，建议清理）`));
    }
    console.log();
  }

  // 注入漂移（ADR-0001 决策 7：条目级差异 + 修复指引；--export 摘要不含本地漂移状态）
  console.log(chalk.bold('注入漂移:'));
  const drift = detectInjectionDrift(projectRoot);
  for (const line of renderInjectionDriftLines(drift)) {
    console.log(drift.hasDrift ? chalk.yellow(line) : line);
  }
  console.log();

  // --export
  if (options.export !== undefined && options.export !== false) {
    const version = getConstraintsMeta().version;
    const now = new Date();
    const markdown = renderExportMarkdown(report, version, now);

    let exportPath: string;
    if (typeof options.export === 'string' && options.export.length > 0) {
      exportPath = path.isAbsolute(options.export) ? options.export : path.join(projectRoot, options.export);
    } else {
      const date = now.toISOString().slice(0, 10).replace(/-/g, '');
      exportPath = path.join(projectRoot, '.harness', 'reports', `constraints-${date}.md`);
    }

    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.writeFileSync(exportPath, markdown, 'utf-8');
    console.log(chalk.green(`✅ 脱敏报告已导出: ${exportPath}`));
  }
}
