/**
 * DashboardDataProvider 测试
 */

import { DashboardDataProvider } from '../data';
import type { KnowledgeEntry } from '../../knowledge/types';
import type { ConstraintStats } from '../../constraints/types';

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

describe('DashboardDataProvider', () => {
  let provider: DashboardDataProvider;

  beforeEach(() => {
    provider = new DashboardDataProvider();
  });

  describe('generate', () => {
    it('应该生成完整 Dashboard 数据', () => {
      const entries = [makeEntry(), makeEntry({ type: 'guideline', maturity: 'proven' })];
      const data = provider.generate(entries);

      expect(data.timestamp).toBeDefined();
      expect(data.knowledgeOverview.total).toBe(2);
      expect(data.constraintHeatmap).toBeDefined();
      expect(data.knowledgeFlow).toBeDefined();
      expect(data.feedbackLoop).toBeDefined();
    });

    it('应该接受约束统计', () => {
      const stats: ConstraintStats[] = [{
        constraintId: 'no_any_type',
        triggerCount: 100,
        passCount: 78,
        interceptCount: 22,
        interceptRate: 22,
        lastTriggered: new Date().toISOString(),
      }];

      const data = provider.generate([], stats);
      const heatmap = data.constraintHeatmap;
      const entry = heatmap.constraints.find(c => c.id === 'no_any_type');
      expect(entry?.trigger).toBe(100);
      expect(entry?.intercept).toBe(22);
    });
  });

  describe('getKnowledgeOverview', () => {
    it('应该返回知识概览', () => {
      const overview = provider.getKnowledgeOverview([makeEntry()]);
      expect(overview.total).toBe(1);
    });
  });

  describe('getConstraintHeatmap', () => {
    it('应该包含所有约束', () => {
      const heatmap = provider.getConstraintHeatmap([]);
      expect(heatmap.constraints.length).toBeGreaterThan(0);
      expect(heatmap.period).toBe('近 30 天');
    });

    it('应该标记从未触发的约束', () => {
      const heatmap = provider.getConstraintHeatmap([]);
      expect(heatmap.neverTriggered.length).toBeGreaterThan(0);
    });

    it('应该检测拦截率下降的约束', () => {
      const stats: ConstraintStats[] = [{
        constraintId: 'no_any_type',
        triggerCount: 100,
        passCount: 90,
        interceptCount: 10,
        interceptRate: 10,
      }];

      const heatmap = provider.getConstraintHeatmap(stats);
      expect(heatmap.decliningInterceptRate.some(c => c.id === 'no_any_type')).toBe(true);
    });
  });

  describe('getFeedbackLoop', () => {
    it('应该返回反馈环状态', () => {
      const loop = provider.getFeedbackLoop();
      expect(loop.local).toBeDefined();
      expect(loop.push).toBeDefined();
      expect(loop.external).toBeDefined();
      expect(loop.feedbackToKnowledge).toBeDefined();
    });
  });

  describe('getRegistry', () => {
    it('应该返回约束注册表', () => {
      expect(provider.getRegistry()).toBeDefined();
      expect(provider.getRegistry().getAll().length).toBeGreaterThan(0);
    });
  });
});
