/**
 * Dashboard stats 测试
 */

import { computeKnowledgeOverview, computeKnowledgeFlow, computeInterceptRate } from '../stats';
import type { KnowledgeEntry } from '../../knowledge/types';

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: `test-${Math.random().toString(36).slice(2, 6)}`,
    type: 'decision',
    title: 'Test',
    content: '',
    maturity: 'verified',
    layer: 'project',
    created: new Date().toISOString(),
    lastReferenced: new Date().toISOString(),
    contributors: [],
    projects: [],
    tags: [],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy: [],
    ...overrides,
  };
}

describe('computeKnowledgeOverview', () => {
  it('应该返回空概览当无条目', () => {
    const overview = computeKnowledgeOverview([]);
    expect(overview.total).toBe(0);
    expect(overview.maturityDistribution.provenPercent).toBe(0);
  });

  it('应该按类型统计', () => {
    const entries = [
      makeEntry({ type: 'decision', maturity: 'proven' }),
      makeEntry({ type: 'decision', maturity: 'verified' }),
      makeEntry({ type: 'guideline', maturity: 'draft' }),
    ];

    const overview = computeKnowledgeOverview(entries);
    expect(overview.total).toBe(3);
    expect(overview.byType.length).toBe(2);

    const decisions = overview.byType.find(b => b.type === 'decision')!;
    expect(decisions.total).toBe(2);
    expect(decisions.proven).toBe(1);
    expect(decisions.verified).toBe(1);
  });

  it('应该计算成熟度分布百分比', () => {
    const entries = [
      makeEntry({ maturity: 'proven' }),
      makeEntry({ maturity: 'proven' }),
      makeEntry({ maturity: 'verified' }),
      makeEntry({ maturity: 'draft' }),
    ];

    const overview = computeKnowledgeOverview(entries);
    expect(overview.maturityDistribution.provenPercent).toBe(50);
    expect(overview.maturityDistribution.verifiedPercent).toBe(25);
    expect(overview.maturityDistribution.draftPercent).toBe(25);
  });

  it('应该计算衰减预警', () => {
    const oldDate = '2020-01-01T00:00:00.000Z';
    const entries = [
      makeEntry({ maturity: 'proven', lastReferenced: oldDate }),
      makeEntry({ maturity: 'verified', lastReferenced: oldDate }),
      makeEntry({ maturity: 'verified', lastReferenced: new Date().toISOString() }),
    ];

    const overview = computeKnowledgeOverview(entries);
    expect(overview.decayWarning.provenUnused6m).toBe(1);
    expect(overview.decayWarning.verifiedUnused3m).toBe(1);
  });

  it('应该用 created 日期当 lastReferenced 为空', () => {
    const oldDate = '2020-01-01T00:00:00.000Z';
    const entries = [
      makeEntry({ maturity: 'proven', lastReferenced: '', created: oldDate }),
    ];

    const overview = computeKnowledgeOverview(entries);
    expect(overview.decayWarning.provenUnused6m).toBe(1);
  });
});

describe('computeKnowledgeFlow', () => {
  it('应该计算基本流转统计', () => {
    const entries = [
      makeEntry({ id: 'a', maturity: 'verified', lastReferenced: new Date().toISOString() }),
      makeEntry({ id: 'b', maturity: 'proven' }),
      makeEntry({ id: 'c', maturity: 'draft', lastReferenced: '' }),
    ];

    const refCounts = new Map<string, number>();
    refCounts.set('a', 10);
    refCounts.set('b', 5);

    const flow = computeKnowledgeFlow(entries, refCounts);
    expect(flow.period).toBe('近 30 天');
    expect(flow.pipeline.referenced).toBe(2);
    expect(flow.topReferenced.length).toBe(2);
    expect(flow.topReferenced[0].id).toBe('a');
    expect(flow.topReferenced[0].referenceCount).toBe(10);
  });

  it('应该限制 topN', () => {
    const entries = [
      makeEntry({ id: 'a' }),
      makeEntry({ id: 'b' }),
      makeEntry({ id: 'c' }),
    ];
    const refCounts = new Map<string, number>([
      ['a', 3], ['b', 2], ['c', 1],
    ]);

    const flow = computeKnowledgeFlow(entries, refCounts, 2);
    expect(flow.topReferenced.length).toBe(2);
  });

  it('应该用 created 日期当 lastReferenced 为空', () => {
    const entries = [
      makeEntry({ id: 'a', maturity: 'verified', lastReferenced: '' }),
    ];
    const flow = computeKnowledgeFlow(entries, new Map());
    // lastReferenced 为空字符串，不计入 referenced
    expect(flow.pipeline.referenced).toBe(0);
  });

  it('应该处理引用了不存在条目的 referenceCount', () => {
    const entries = [makeEntry({ id: 'a' })];
    const refCounts = new Map<string, number>([
      ['a', 5],
      ['nonexistent', 3],
    ]);

    const flow = computeKnowledgeFlow(entries, refCounts, 5);
    const missing = flow.topReferenced.find(t => t.id === 'nonexistent');
    expect(missing).toBeDefined();
    expect(missing?.title).toBe('nonexistent'); // fallback to id
  });
});

describe('computeInterceptRate', () => {
  it('应该计算拦截率', () => {
    expect(computeInterceptRate(100, 22)).toBe(22);
    expect(computeInterceptRate(10, 0)).toBe(0);
  });

  it('应该处理零触发', () => {
    expect(computeInterceptRate(0, 0)).toBe(0);
  });
});
