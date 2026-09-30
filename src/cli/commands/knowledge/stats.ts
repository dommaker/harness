/**
 * harness knowledge stats 子命令（Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { evaluateFlywheel } from '../../../knowledge/flywheel-metrics';
import type { MaturityLevel } from '../../../knowledge/types';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  blankLine,
  emitKnowledgeView,
  openKnowledgeStore,
  toneForMaturity,
  type DisplayModel,
  type DisplayRow,
} from '../knowledge-view';
import type { KnowledgeOptions } from './shared';

export function knowledgeStatsView(options: KnowledgeOptions, io: CommandIO) {
  const store = openKnowledgeStore(options, io);
  const entries = store.list({ excludeArchived: false });
  const active = entries.filter(e => e.maturity !== 'archived');

  const byType: Record<string, number> = {};
  const byMaturity: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byMaturity[entry.maturity] = (byMaturity[entry.maturity] || 0) + 1;
    byLayer[entry.layer] = (byLayer[entry.layer] || 0) + 1;
  }

  // 飞轮指标：计算唯一实现在 knowledge/flywheel-metrics，此处只做 fs 读取 + 展示层单位映射
  // fail-fast：统计文件在场但损坏直接抛（existsSync 判缺失，不吞解析错误）
  let dailyConsumptionEvents = 0;
  const statsPath = path.join(store.getBaseDir(), '.consumption-stats.json');
  if (fs.existsSync(statsPath)) {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
    dailyConsumptionEvents = stats.dailyEvents || 0;
  }

  const metrics = evaluateFlywheel({ entries: active, dailyConsumptionEvents });
  const flywheel = {
    refCoverage: Math.round(metrics.refCoverage * 100),
    avgRefs: Math.round(metrics.avgRefs * 10) / 10,
    consumptionHitRate: Math.round(metrics.consumptionHitRate * 100),
  };

  const data = { total: entries.length, byType, byMaturity, byLayer, flywheel };
  const activeCount = active.length;

  return {
    data,
    human: (): DisplayModel => ({
      sections: [
        {
          rows: [
            { cells: [{ label: '📊 知识库统计', tone: 'heading' }] },
            blankLine(),
            {
              cells: [
                { label: '  总计: ', tone: 'emph' },
                { field: 'total', text: String(data.total), tone: 'emph' },
                { label: ' 条 (活跃: ', tone: 'emph' },
                { derived: 'activeCount', text: String(activeCount), tone: 'emph' },
                { label: ')', tone: 'emph' },
              ],
            },
            blankLine(),
          ],
        },
        { title: '  按类型:', rows: [...countRows('byType', byType), blankLine()] },
        {
          title: '  按成熟度:',
          rows: [...Object.entries(byMaturity).map(([maturity, count]) => ({
            cells: [
              { field: `byMaturity.${maturity}`, text: `    ${maturity}`, tone: toneForMaturity(maturity as MaturityLevel) },
              { field: `byMaturity.${maturity}`, text: `: ${count}` },
            ],
          })), blankLine()],
        },
        { title: '  按层级:', rows: [...countRows('byLayer', byLayer), blankLine()] },
        {
          title: '  飞轮指标:',
          rows: [
            { cells: [{ label: '    引用覆盖: ' }, { field: 'flywheel.refCoverage', text: `${flywheel.refCoverage}%` }] },
            { cells: [{ label: '    平均引用: ' }, { field: 'flywheel.avgRefs', text: String(flywheel.avgRefs) }] },
            { cells: [{ label: '    消费命中率: ' }, { field: 'flywheel.consumptionHitRate', text: `${flywheel.consumptionHitRate}%` }] },
          ],
        },
      ],
    }),
  };
}

function countRows(field: string, counts: Record<string, number>): DisplayRow[] {
  return Object.entries(counts).map(([key, count]) => ({
    cells: [
      { label: '    ' },
      { field: `${field}.${key}`, text: `${key}: ${count}` },
    ],
  }));
}

export async function knowledgeStats(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeStatsView(options, io));
}
