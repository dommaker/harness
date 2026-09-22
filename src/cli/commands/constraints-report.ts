/**
 * harness constraints report —— 约束使用报告（ADR-0001 决策 3/4，ADR-0029 收窄）
 *
 * 面向"人审约束"场景：
 * - check 约束统计表（total/pass/fail/skip、fail 率、首次/最近触发）
 * - 退役候选诊断（零触发/零拦截/不可评估/高噪），retire 交互模式的数据源
 * - 零拦截观察名单（ADR-0032，块 3 子项 4）：零拦截命中先进观察名单挂一个季度，
 *   进 report 但不进退役候选，期满且样本足才转候选；名单状态经 StateIO 读-改-写
 *   `.harness/.state.json`（本命令因此不再是纯只读——唯一写点是观察名单列入）
 * - 配置健康（unknownIds 残留提示）
 * - --export [file]：脱敏 markdown 摘要（不含项目路径）
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  buildConstraintsUsageReport,
  CANDIDATE_KIND_LABEL,
  DEFAULT_DIAGNOSE_THRESHOLDS,
  WATCHLIST_PERIOD_DAYS,
  type ConstraintsUsageReport,
  type ConstraintUsageStats,
  type DiagnoseThresholds,
} from '../../core/constraints/usage-report';
import { fileStateIO, type StateIO } from '../state-io';
import { getConstraintsMeta } from './constraints';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

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
  /**
   * 观察名单状态接缝（缺省 = fileStateIO(projectPath)）。
   * 注入则 `.harness/.state.json` 的读写全程走注入面（ADR-0026 同口径）。
   */
  stateIO?: StateIO;
  /** 观察期判定时钟（Unix ms），测试注入用——别在测试里等 90 天 */
  now?: number;
}

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
  if (report.skippedLines > 0) {
    // 脱敏：只报条数，不报路径、不报坏行内容
    lines.push(`- ⚠️ trace 文件有 ${report.skippedLines} 行损坏已跳过，下表统计只含其余合法记录`);
  }
  lines.push('');

  lines.push('## 统计表');
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

  // 观察名单（块 3 子项 4）：进报告不进候选，列入时间与剩余观察期随条目带出
  lines.push('## 观察名单');
  lines.push('');
  if (report.watchlist.length === 0) {
    lines.push('（空）');
  } else {
    for (const w of report.watchlist) {
      lines.push(`- \`${w.id}\` — ${w.reason}（列入 ${w.listedAt.slice(0, 10)}，剩余观察 ${w.remainingDays} 天；满 ${WATCHLIST_PERIOD_DAYS} 天且样本足转退役候选）`);
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
 * CLI handler: harness constraints report
 */
export async function constraintsReport(options: ConstraintsReportOptions = {}, io: CommandIO = processIO): Promise<CommandResult> {
  const projectRoot = options.projectPath || process.cwd();
  const thresholds: Partial<DiagnoseThresholds> = {};
  if (options.zeroInterceptMin !== undefined) thresholds.zeroInterceptMinEvaluated = options.zeroInterceptMin;
  if (options.noiseFailRate !== undefined) thresholds.highNoiseFailRate = options.noiseFailRate;
  if (options.noiseMinTotal !== undefined) thresholds.highNoiseMinEvaluated = options.noiseMinTotal;

  const stateIO = options.stateIO ?? fileStateIO(projectRoot);
  const state = stateIO.read();
  const report = buildConstraintsUsageReport(projectRoot, thresholds, {
    watchlist: state.constraintWatchlist,
    now: options.now,
  });
  // 观察名单只增不删：键数变多 = 本次有新列入，经 StateIO 写回（读-改-写，不动其他字段）
  if (Object.keys(report.nextWatchlist).length > Object.keys(state.constraintWatchlist ?? {}).length) {
    stateIO.write({ ...state, constraintWatchlist: report.nextWatchlist });
  }

  if (options.json) {
    log(io, JSON.stringify(report, null, 2));
    return { kind: 'ok' };
  }

  log(io, chalk.blue('📊 约束使用报告'));
  if (!report.traceFileExists) {
    log(io, chalk.gray('   （trace 文件不存在，全部按零触发统计）'));
  }
  if (report.skippedLines > 0) {
    log(io, chalk.yellow(`   ⚠️  trace 文件有 ${report.skippedLines} 行损坏已跳过，统计只含其余合法记录（数据不完整）`));
  }
  log(io);

  // 统计表
  log(io, chalk.bold('统计表:'));
  for (const s of report.stats) {
    log(io, `  ${renderStatsRow(s)}`);
  }
  log(io);

  // 候选诊断
  log(io, chalk.bold(`退役候选（${report.candidates.length} 条，阈值: 零拦截≥${thresholds.zeroInterceptMinEvaluated ?? DEFAULT_DIAGNOSE_THRESHOLDS.zeroInterceptMinEvaluated} 次评估, 高噪 fail率>${Math.round((thresholds.highNoiseFailRate ?? DEFAULT_DIAGNOSE_THRESHOLDS.highNoiseFailRate) * 100)}% 且 ≥${thresholds.highNoiseMinEvaluated ?? DEFAULT_DIAGNOSE_THRESHOLDS.highNoiseMinEvaluated} 次评估）:`));
  if (report.candidates.length === 0) {
    log(io, chalk.green('  （无候选）'));
  } else {
    for (const c of report.candidates) {
      log(io, `  [${CANDIDATE_KIND_LABEL[c.kind]}] ${c.id} — ${c.reason}`);
    }
    log(io, chalk.gray('  可运行 `harness constraints retire` 交互式处理候选'));
  }
  log(io);

  // 观察名单分组（零拦截中间态，块 3 子项 4）：无条目零噪声
  if (report.watchlist.length > 0) {
    log(io, chalk.bold(`观察名单（${report.watchlist.length} 条，零拦截观察期 ${WATCHLIST_PERIOD_DAYS} 天，期满且样本足才转退役候选）:`));
    for (const w of report.watchlist) {
      log(io, `  [观察中] ${w.id} — ${w.reason}（列入 ${w.listedAt.slice(0, 10)}，剩余观察 ${w.remainingDays} 天）`);
    }
    log(io);
  }

  // 配置健康
  if (report.lint.unknownIds.length > 0) {
    log(io, chalk.yellow('⚠️  配置健康:'));
    for (const id of report.lint.unknownIds) {
      log(io, chalk.yellow(`  config.yml 中禁用了不存在/已移除的约束 id: ${id}（残留配置，建议清理）`));
    }
    log(io);
  }

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
    log(io, chalk.green(`✅ 脱敏报告已导出: ${exportPath}`));
  }
  return { kind: 'ok' };
}
