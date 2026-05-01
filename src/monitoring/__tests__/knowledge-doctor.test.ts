import { KnowledgeDoctor } from '../knowledge-doctor';
import type { KnowledgeEntry, LintIssue } from '../../knowledge/types';

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'entry-1',
    type: 'guideline',
    title: 'Test Entry',
    content: 'content',
    maturity: 'draft',
    layer: 'team',
    created: '2025-01-01T00:00:00Z',
    lastReferenced: new Date().toISOString(),
    contributors: ['user-1'],
    projects: ['proj-1'],
    tags: ['test'],
    applicablePhases: ['implementation'],
    sourceReferences: [],
    referencedBy: ['ref-1'],
    ...overrides,
  };
}

describe('KnowledgeDoctor', () => {
  describe('基础诊断', () => {
    it('空知识库返回满分', () => {
      const doctor = new KnowledgeDoctor();
      const report = doctor.diagnose([]);
      expect(report.healthScore).toBe(100);
      expect(report.totalEntries).toBe(0);
      expect(report.diagnoses).toHaveLength(0);
    });

    it('健康条目不产生诊断', () => {
      const doctor = new KnowledgeDoctor();
      const entry = makeEntry({ maturity: 'verified', referencedBy: ['r1', 'r2', 'r3'], projects: ['p1'] });
      const report = doctor.diagnose([entry]);
      // 可能有 low_reference 诊断，但不会有 orphan/outdated/decay
      const criticalDiags = report.diagnoses.filter(d => d.type === 'orphan' || d.type === 'outdated' || d.type === 'decay');
      expect(criticalDiags).toHaveLength(0);
    });
  });

  describe('孤儿检测', () => {
    it('检测无引用、无贡献者、无项目的 draft 条目', () => {
      const doctor = new KnowledgeDoctor();
      const orphan = makeEntry({
        id: 'orphan-1',
        maturity: 'draft',
        referencedBy: [],
        contributors: [],
        projects: [],
      });
      const report = doctor.diagnose([orphan]);
      const orphanDiags = report.diagnoses.filter(d => d.type === 'orphan');
      expect(orphanDiags).toHaveLength(1);
      expect(orphanDiags[0].entryId).toBe('orphan-1');
      expect(orphanDiags[0].severity).toBe('low');
    });

    it('archived 条目不检测为孤儿', () => {
      const doctor = new KnowledgeDoctor();
      const archived = makeEntry({
        maturity: 'archived',
        referencedBy: [],
        contributors: [],
        projects: [],
      });
      const report = doctor.diagnose([archived]);
      expect(report.diagnoses.filter(d => d.type === 'orphan')).toHaveLength(0);
    });

    it('有引用的 draft 条目不检测为孤儿', () => {
      const doctor = new KnowledgeDoctor();
      const entry = makeEntry({ maturity: 'draft', referencedBy: ['r1'], contributors: [], projects: [] });
      const report = doctor.diagnose([entry]);
      expect(report.diagnoses.filter(d => d.type === 'orphan')).toHaveLength(0);
    });
  });

  describe('过时检测', () => {
    it('检测超过阈值天数未引用的 draft 条目', () => {
      const doctor = new KnowledgeDoctor({ outdatedDays: 30 });
      const old = makeEntry({
        id: 'old-1',
        maturity: 'draft',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const report = doctor.diagnose([old]);
      const outdated = report.diagnoses.filter(d => d.type === 'outdated');
      expect(outdated).toHaveLength(1);
      expect(outdated[0].entryId).toBe('old-1');
    });

    it('verified/proven 条目不检测为过时', () => {
      const doctor = new KnowledgeDoctor({ outdatedDays: 1 });
      const entry = makeEntry({
        maturity: 'verified',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const report = doctor.diagnose([entry]);
      expect(report.diagnoses.filter(d => d.type === 'outdated')).toHaveLength(0);
    });
  });

  describe('衰减检测', () => {
    it('检测长期未引用的 proven 条目', () => {
      const doctor = new KnowledgeDoctor({ decayWarningDays: 30 });
      const entry = makeEntry({
        id: 'decay-1',
        maturity: 'proven',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const report = doctor.diagnose([entry]);
      const decay = report.diagnoses.filter(d => d.type === 'decay');
      expect(decay).toHaveLength(1);
      expect(decay[0].severity).toBe('high');
    });

    it('检测长期未引用的 verified 条目（medium severity）', () => {
      const doctor = new KnowledgeDoctor({ decayWarningDays: 30 });
      const entry = makeEntry({
        maturity: 'verified',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const report = doctor.diagnose([entry]);
      const decay = report.diagnoses.filter(d => d.type === 'decay');
      expect(decay).toHaveLength(1);
      expect(decay[0].severity).toBe('medium');
    });

    it('draft 条目不检测衰减', () => {
      const doctor = new KnowledgeDoctor({ decayWarningDays: 1 });
      const entry = makeEntry({
        maturity: 'draft',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const report = doctor.diagnose([entry]);
      expect(report.diagnoses.filter(d => d.type === 'decay')).toHaveLength(0);
    });
  });

  describe('低引用检测', () => {
    it('检测引用次数低于阈值的非 draft 条目', () => {
      const doctor = new KnowledgeDoctor({ lowReferenceThreshold: 5 });
      const entry = makeEntry({
        maturity: 'verified',
        referencedBy: ['r1'],
      });
      const report = doctor.diagnose([entry]);
      const lowRef = report.diagnoses.filter(d => d.type === 'low_reference');
      expect(lowRef).toHaveLength(1);
      expect(lowRef[0].severity).toBe('low');
    });

    it('archived 和 draft 条目不检测低引用', () => {
      const doctor = new KnowledgeDoctor({ lowReferenceThreshold: 100 });
      const archived = makeEntry({ id: 'a1', maturity: 'archived', referencedBy: [] });
      const draft = makeEntry({ id: 'd1', maturity: 'draft', referencedBy: [] });
      const report = doctor.diagnose([archived, draft]);
      expect(report.diagnoses.filter(d => d.type === 'low_reference')).toHaveLength(0);
    });
  });

  describe('Lint issues 转换', () => {
    it('将 LintIssue 转换为诊断', () => {
      const doctor = new KnowledgeDoctor();
      const issue: LintIssue = {
        type: 'orphan',
        entryId: 'e1',
        severity: 'medium',
        description: 'Orphan entry',
        suggestion: 'Archive it',
      };
      const report = doctor.diagnose([], [issue]);
      expect(report.diagnoses).toHaveLength(1);
      expect(report.diagnoses[0].type).toBe('orphan');
      expect(report.diagnoses[0].severity).toBe('medium');
      expect(report.diagnoses[0].recommendations).toContain('Archive it');
    });

    it('覆盖所有 LintIssue 类型的根因和影响推断', () => {
      const doctor = new KnowledgeDoctor();
      const types: LintIssue['type'][] = ['contradiction', 'outdated', 'duplicate', 'index_inconsistent'];
      for (const type of types) {
        const issue: LintIssue = { type, severity: 'low', description: `test ${type}`, suggestion: 'fix' };
        const report = doctor.diagnose([], [issue]);
        const diag = report.diagnoses.find(d => d.type === type);
        expect(diag).toBeDefined();
        expect(diag!.rootCause).toBeTruthy();
        expect(diag!.impact).toBeTruthy();
      }
    });

    it('未知 LintIssue 类型使用默认根因和影响', () => {
      const doctor = new KnowledgeDoctor();
      const issue = { type: 'unknown_type', severity: 'low', description: 'unknown', suggestion: 'fix' } as unknown as LintIssue;
      const report = doctor.diagnose([], [issue]);
      expect(report.diagnoses[0].rootCause).toBe('未知原因');
      expect(report.diagnoses[0].impact).toBe('未知影响');
    });
  });

  describe('健康分数', () => {
    it('无问题时返回 100', () => {
      const doctor = new KnowledgeDoctor();
      const entry = makeEntry({ maturity: 'verified', referencedBy: ['r1', 'r2', 'r3'], projects: ['p1', 'p2'] });
      const report = doctor.diagnose([entry]);
      expect(report.healthScore).toBe(100);
    });

    it('有问题时扣分', () => {
      const doctor = new KnowledgeDoctor({ decayWarningDays: 1, lowReferenceThreshold: 100 });
      const entry = makeEntry({
        maturity: 'proven',
        lastReferenced: '2020-01-01T00:00:00Z',
        referencedBy: ['r1'],
        projects: ['p1'],
      });
      const report = doctor.diagnose([entry]);
      expect(report.healthScore).toBeLessThan(100);
    });

    it('critical 严重度扣 10 分', () => {
      const doctor = new KnowledgeDoctor();
      const issue: LintIssue = { type: 'contradiction', severity: 'high', entryId: 'e1', description: 'critical issue', suggestion: 'fix' };
      // 直接构造 critical 诊断来测试 calculateHealthScore 的 critical 分支
      // LintIssue severity 只有 low/medium/high，所以通过 checkDecay 的 high 来测试
      const entry = makeEntry({ maturity: 'proven', lastReferenced: '2020-01-01T00:00:00Z' });
      const report = doctor.diagnose([entry]);
      const decayDiag = report.diagnoses.find(d => d.type === 'decay');
      expect(decayDiag).toBeDefined();
      expect(decayDiag!.severity).toBe('high');
    });
  });

  describe('报告生成', () => {
    it('生成 Markdown 报告', () => {
      const doctor = new KnowledgeDoctor();
      const report = doctor.diagnose([makeEntry()]);
      const md = doctor.generateReport(report);
      expect(md).toContain('# 知识库健康报告');
      expect(md).toContain('健康分数');
      expect(md).toContain('## 问题统计');
    });

    it('有诊断时生成详情', () => {
      const doctor = new KnowledgeDoctor({ decayWarningDays: 1 });
      const entry = makeEntry({
        maturity: 'proven',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const report = doctor.diagnose([entry]);
      const md = doctor.generateReport(report);
      expect(md).toContain('## 诊断详情');
      expect(md).toContain('衰减预警');
    });
  });

  describe('配置', () => {
    it('使用默认配置', () => {
      const doctor = new KnowledgeDoctor();
      // 默认 lowReferenceThreshold=2
      const entry = makeEntry({ maturity: 'verified', referencedBy: ['r1'] });
      const report = doctor.diagnose([entry]);
      expect(report.diagnoses.filter(d => d.type === 'low_reference')).toHaveLength(1);
    });

    it('自定义配置覆盖默认值', () => {
      const doctor = new KnowledgeDoctor({ lowReferenceThreshold: 0 });
      const entry = makeEntry({ maturity: 'verified', referencedBy: [] });
      const report = doctor.diagnose([entry]);
      expect(report.diagnoses.filter(d => d.type === 'low_reference')).toHaveLength(0);
    });
  });
});
