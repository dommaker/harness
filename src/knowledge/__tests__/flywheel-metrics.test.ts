/**
 * 知识飞轮指标纯判定测试（harness#81）
 *
 * interface 即测试面：喂 active 条目数组 + 可选消费事件数，断言 canonical 指标，零 fs。
 * 口径正本 = genuine refs（过滤 synthetic 后）：此前 audit/stats/health 三处各自实现分子计算，
 * stats/health 用原始 referencedBy.length 把自动化触碰算成消费，同一库报出两套飞轮健康度。
 */

import { describe, it, expect } from '@jest/globals';
import { evaluateFlywheel, genuineRefs } from '../flywheel-metrics';
import type { KnowledgeEntry } from '../types';

function makeEntry(id: string, referencedBy: string[]): KnowledgeEntry {
  return {
    id,
    type: 'guideline',
    title: `entry ${id}`,
    content: 'meaningful content long enough to survive every audit threshold',
    maturity: 'verified',
    layer: 'project',
    created: '2026-09-01T00:00:00.000Z',
    lastReferenced: '2026-09-01T00:00:00.000Z',
    contributors: ['human'],
    projects: ['harness'],
    tags: [],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy,
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
  };
}

// ── genuineRefs：synthetic 过滤口径 ─────────────────────

describe('genuineRefs — synthetic 过滤口径', () => {
  for (const prefix of [
    'search', 'test-agent', 'prompt-inject', 'monitor',
    'analyst', 'auditor', 'triage', 'executor', 'session', 'trend', 'incident',
  ]) {
    it(`过滤自动化写入方 ${prefix}:<date>`, () => {
      expect(genuineRefs([`${prefix}:2026-09-01`])).toEqual([]);
    });
  }

  it('保留人/决策类引用（含同前缀但非日期键的历史写法）', () => {
    const refs = [
      'agent-a:2026-09-01',
      'decision-123',
      'unknown:2026-09-01',
      'search:not-a-date',
      'xsearch:2026-09-01',
    ];
    expect(genuineRefs(refs)).toEqual([
      'agent-a:2026-09-01',
      'decision-123',
      'unknown:2026-09-01',
      'search:not-a-date',
      'xsearch:2026-09-01',
    ]);
  });

  it('无结束锚点：日期后带后缀的自动化键同样过滤', () => {
    expect(genuineRefs(['search:2026-09-01:extra'])).toEqual([]);
  });

  it('不改动入参数组（纯函数，不过滤掉调用方数据）', () => {
    const refs = ['agent-a:2026-09-01', 'search:2026-09-01'];
    genuineRefs(refs);
    expect(refs).toHaveLength(2);
  });
});

// ── evaluateFlywheel：canonical 指标 ────────────────────

describe('evaluateFlywheel — 引用侧指标', () => {
  it('refCoverage / avgRefs 为未取整比例，分子只数 genuine refs', () => {
    const metrics = evaluateFlywheel({
      entries: [
        makeEntry('K-001', ['agent-a:2026-09-01', 'search:2026-09-01']),
        makeEntry('K-002', ['prompt-inject:2026-08-30', 'test-agent:2026-08-31']),
        makeEntry('K-003', []),
        makeEntry('K-004', ['decision-1:2026-07-01', 'studio-web:2026-07-02']),
      ],
    });

    // 2/4 条目有真实引用；genuine refs 共 3 条 / 4 条目
    expect(metrics.activeEntries).toBe(4);
    expect(metrics.entriesWithRefs).toBe(2);
    expect(metrics.refCoverage).toBe(0.5);
    expect(metrics.avgRefs).toBe(0.75);
  });

  it('纯 synthetic 引用不给条目续命（覆盖与均值都归零）', () => {
    const metrics = evaluateFlywheel({
      entries: [makeEntry('K-001', ['search:2026-09-01', 'analyst:2026-09-01'])],
    });
    expect(metrics.entriesWithRefs).toBe(0);
    expect(metrics.refCoverage).toBe(0);
    expect(metrics.avgRefs).toBe(0);
  });

  it('空人口 → 全 0，不出 NaN / 不做除零', () => {
    const metrics = evaluateFlywheel({ entries: [], dailyConsumptionEvents: 10 });
    expect(metrics).toMatchObject({
      activeEntries: 0,
      entriesWithRefs: 0,
      refCoverage: 0,
      avgRefs: 0,
      consumptionHitRate: 0,
    });
  });

  it('不改动传入条目（人口筛选属调用方，本 module 零副作用）', () => {
    const entries = [makeEntry('K-001', ['agent-a:2026-09-01', 'search:2026-09-01'])];
    const before = JSON.stringify(entries);
    evaluateFlywheel({ entries });
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('evaluateFlywheel — 消费命中率', () => {
  it('未传消费事件 → 0，输入值原样透传便于报告层复用', () => {
    const metrics = evaluateFlywheel({ entries: [makeEntry('K-001', ['agent-a:2026-09-01'])] });
    expect(metrics.dailyConsumptionEvents).toBe(0);
    expect(metrics.consumptionHitRate).toBe(0);
  });

  it('dailyEvents / activeEntries，capped at 1', () => {
    const entries = [makeEntry('K-001', []), makeEntry('K-002', [])];
    expect(evaluateFlywheel({ entries, dailyConsumptionEvents: 1 }).consumptionHitRate).toBe(0.5);
    expect(evaluateFlywheel({ entries, dailyConsumptionEvents: 99 }).consumptionHitRate).toBe(1);
  });
});
