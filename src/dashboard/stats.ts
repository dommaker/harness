/**
 * Dashboard 统计计算
 *
 * 纯函数，从原始数据计算统计指标
 */

import type { KnowledgeEntry, KnowledgeType, MaturityLevel } from '../knowledge/types';
import type { KnowledgeOverview, KnowledgeFlow } from './types';

/**
 * 计算知识库概览
 */
export function computeKnowledgeOverview(entries: KnowledgeEntry[]): KnowledgeOverview {
  const byType = computeByType(entries);
  const total = entries.length;
  const proven = entries.filter(e => e.maturity === 'proven').length;
  const verified = entries.filter(e => e.maturity === 'verified').length;
  const draft = entries.filter(e => e.maturity === 'draft').length;

  return {
    byType,
    total,
    maturityDistribution: {
      proven,
      verified,
      draft,
      provenPercent: total > 0 ? Math.round((proven / total) * 100) : 0,
      verifiedPercent: total > 0 ? Math.round((verified / total) * 100) : 0,
      draftPercent: total > 0 ? Math.round((draft / total) * 100) : 0,
    },
    decayWarning: computeDecayWarning(entries),
  };
}

/**
 * 按类型分组统计
 */
function computeByType(entries: KnowledgeEntry[]): KnowledgeOverview['byType'] {
  const typeMap = new Map<KnowledgeType, { total: number; proven: number; verified: number; draft: number }>();

  for (const entry of entries) {
    const existing = typeMap.get(entry.type) || { total: 0, proven: 0, verified: 0, draft: 0 };
    existing.total++;
    if (entry.maturity === 'proven') existing.proven++;
    else if (entry.maturity === 'verified') existing.verified++;
    else if (entry.maturity === 'draft') existing.draft++;
    typeMap.set(entry.type, existing);
  }

  return [...typeMap.entries()].map(([type, stats]) => ({ type, ...stats }));
}

/**
 * 计算衰减预警
 */
function computeDecayWarning(entries: KnowledgeEntry[]): KnowledgeOverview['decayWarning'] {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  let provenUnused6m = 0;
  let verifiedUnused3m = 0;

  for (const entry of entries) {
    const lastRef = entry.lastReferenced ? new Date(entry.lastReferenced) : new Date(entry.created);

    if (entry.maturity === 'proven' && lastRef < sixMonthsAgo) {
      provenUnused6m++;
    }
    if (entry.maturity === 'verified' && lastRef < threeMonthsAgo) {
      verifiedUnused3m++;
    }
  }

  return { provenUnused6m, verifiedUnused3m };
}

/**
 * 计算知识流转统计
 */
export function computeKnowledgeFlow(
  entries: KnowledgeEntry[],
  referenceCounts: Map<string, number>,
  topN: number = 5,
): KnowledgeFlow {
  // 成熟度转换统计（基于当前状态推断）
  const transitions = {
    draftToVerified: entries.filter(e => e.maturity === 'verified' && e.lastReferenced).length,
    verifiedToProven: entries.filter(e => e.maturity === 'proven').length,
    provenToVerified: 0, // 需要历史数据
    verifiedToDraft: 0,  // 需要历史数据
  };

  // Top N 高频引用
  const topReferenced = [...referenceCounts.entries()]
    .map(([id, count]) => {
      const entry = entries.find(e => e.id === id);
      return { id, title: entry?.title ?? id, referenceCount: count };
    })
    .sort((a, b) => b.referenceCount - a.referenceCount)
    .slice(0, topN);

  const referenced = entries.filter(e => e.lastReferenced).length;

  return {
    period: '近 30 天',
    pipeline: {
      extracted: 0,   // 需要 ingestion 日志
      ingested: 0,     // 需要 ingestion 日志
      referenced,
      upgraded: transitions.draftToVerified + transitions.verifiedToProven,
      downgraded: transitions.provenToVerified + transitions.verifiedToDraft,
    },
    transitions,
    topReferenced,
  };
}

/**
 * 计算约束拦截率
 */
export function computeInterceptRate(triggerCount: number, interceptCount: number): number {
  if (triggerCount === 0) return 0;
  return Math.round((interceptCount / triggerCount) * 100);
}
