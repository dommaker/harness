/**
 * harness knowledge health 子命令（飞轮健康检查 — 零 token 检测数据流状态；
 * Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：健康分与过期判定不自有算法——健康分 =
 * `audit-scoring.calculateHealthScore`，过期条目 = `audit-rules` 的 stale-entry
 * 规则命中（ADR-0040 Phase 4 收口，此前本文件内联第三套打分与过期口径）。
 * 上色、json/人读分派、退出码、路径解析与 store 构造统一在
 * knowledge-view.ts（harness#133，架构评审候选4）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { evaluateFlywheel } from '../../../knowledge/flywheel-metrics';
import { AUDIT_RULE_LABELS } from '../../../knowledge/audit-rules';
import { calculateHealthScore, scanEntries } from '../../../knowledge/audit-scoring';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  blankLine,
  emitKnowledgeView,
  openKnowledgeStore,
  toneForScore,
  toneForSeverity,
  type DisplayModel,
  type DisplayRow,
  type DisplaySection,
} from '../knowledge-view';
import type { KnowledgeDirOption, KnowledgeOptions } from './shared';

interface HealthIssue {
  severity: 'error' | 'warn' | 'info';
  entry: string;
  detail: string;
}

/** health 的 json 面正本（字段清单冻结在 __tests__/knowledge-view.test.ts） */
interface HealthData {
  healthScore: number;
  summary: {
    total: number;
    lowRefEntries: number;
    staleEntries: number;
    consumptionData: boolean;
    refCoverage: number;
    avgRefs: number;
  };
  issues: HealthIssue[];
}

/** audit severity → 本命令三档展示severity */
function displaySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): HealthIssue['severity'] {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warn';
  return 'info';
}

export function knowledgeHealthView(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO) {
  const store = openKnowledgeStore(options, io);
  const baseDir = store.getBaseDir();
  const entries = store.list({ excludeArchived: true });

  // 健康分与过期判定唯一正本 = audit 纯打分（stale-entry 口径：lastReferenced || created 超阈值）
  const auditIssues = scanEntries(entries, {}, entries);
  const healthScore = calculateHealthScore(entries, auditIssues);
  const staleEntries = auditIssues.filter(i => i.rule === 'stale-entry').length;

  const issues: HealthIssue[] = auditIssues.map(i => ({
    severity: displaySeverity(i.severity),
    entry: i.entryId,
    detail: `${AUDIT_RULE_LABELS[i.rule]}: ${i.detail}`,
  }));

  // D1: 引用密度检查（低引用 = 可能孤立；逐条 issue 线索，非聚合分子，ADR-0013 范围外）
  let lowRefEntries = 0;
  for (const entry of entries) {
    if (entry.referencedBy.length === 0 && entry.maturity === 'verified') {
      lowRefEntries++;
      issues.push({ severity: 'info', entry: entry.id, detail: `verified 条目零引用（可能孤立）` });
    }
  }

  // D3: 消费数据检查
  const statsPath = path.join(baseDir, '.consumption-stats.json');
  const consumptionData = fs.existsSync(statsPath);
  if (!consumptionData) {
    issues.push({ severity: 'info', entry: '-', detail: `消费追踪数据不存在（${statsPath}）` });
  }

  // D4: 飞轮指标（计算唯一实现在 knowledge/flywheel-metrics；人口为本命令的 excludeArchived 切片）
  const metrics = evaluateFlywheel({ entries });
  const refCoverage = Math.round(metrics.refCoverage * 100);
  const avgRefs = Math.round(metrics.avgRefs * 10) / 10;

  const data: HealthData = {
    healthScore,
    summary: { total: entries.length, lowRefEntries, staleEntries, consumptionData, refCoverage, avgRefs },
    issues: issues.slice(0, 50),
  };

  return { data, human: (): DisplayModel => ({ sections: healthSections(data) }) };
}

function healthSections(data: HealthData): DisplaySection[] {
  const { healthScore, summary, issues } = data;
  const scoreTone = toneForScore(healthScore);
  return [
    {
      rows: [
        { cells: [{ label: '🏥 飞轮健康检查', tone: 'heading' }] },
        blankLine(),
        { cells: [
          { label: '  健康分: ', tone: 'emph' },
          { field: 'healthScore', text: String(healthScore), tone: scoreTone },
          { label: '/100', tone: 'emph' },
        ] },
        { cells: [
          { label: '  活跃条目: ', tone: 'emph' },
          { field: 'summary.total', text: String(summary.total), tone: 'emph' },
        ] },
        blankLine(),
      ],
    },
    {
      title: '  数据流状态:',
      rows: [
        densityRow('    引用密度: ', 'summary.lowRefEntries', summary.lowRefEntries, ' 个零引用 verified'),
        densityRow('    新鲜度: ', 'summary.staleEntries', summary.staleEntries, ' 个过期条目'),
        { cells: [
          { label: '    消费追踪: ' },
          summary.consumptionData
            ? { label: '✓', tone: 'ok' }
            : { field: 'summary.consumptionData', text: '○ 未启用', tone: 'muted' },
        ] },
        blankLine(),
      ],
    },
    {
      title: '  飞轮指标:',
      rows: [
        { cells: [{ label: '    引用覆盖: ' }, { field: 'summary.refCoverage', text: `${summary.refCoverage}%` }] },
        { cells: [{ label: '    平均引用: ' }, { field: 'summary.avgRefs', text: String(summary.avgRefs) }] },
        blankLine(),
      ],
    },
    {
      title: '  问题 (前 20):',
      rows: issues.length === 0
        ? [{ cells: [{ label: '  ✓ 无问题', tone: 'ok' }] }]
        : [
          ...issues.slice(0, 20).map((issue, i) => ({
            cells: [
              { field: `issues.${i}.severity`, text: `    [${issue.severity}]`, tone: toneForSeverity(issue.severity) },
              { field: `issues.${i}.entry`, text: ` ${issue.entry}: ` },
              { field: `issues.${i}.detail`, text: issue.detail },
            ],
          })),
          // 溢出计数取全量数组，而 json 面的 issues 已截 50 条 → 无字段可锚，登记派生量
          ...(issues.length > 20
            ? [{ cells: [{ derived: 'healthIssuesOverflow', text: `    ... 还有 ${issues.length - 20} 条`, tone: 'muted' as const }] }]
            : []),
        ],
    },
  ];
}

function densityRow(prefix: string, field: string, count: number, suffix: string): DisplayRow {
  if (count === 0) return { cells: [{ label: prefix }, { label: '✓', tone: 'ok' }] };
  return {
    cells: [
      { label: prefix },
      { label: '⚠ ', tone: 'warn' },
      { field, text: String(count), tone: 'warn' },
      { label: suffix, tone: 'warn' },
    ],
  };
}

export async function knowledgeHealth(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeHealthView(options, io));
}
