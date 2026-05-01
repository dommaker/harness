import { KnowledgeEvolver } from '../knowledge-evolver';
import type { KnowledgeDiagnosis } from '../knowledge-doctor';
import type { KnowledgeEntry } from '../../knowledge/types';

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

describe('KnowledgeEvolver', () => {
  describe('升级提案', () => {
    it('draft 有引用时提议升级为 verified', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ maturity: 'draft', referencedBy: ['r1'] });
      const proposals = evolver.generateProposals([entry]);
      const promote = proposals.filter(p => p.action === 'promote');
      expect(promote).toHaveLength(1);
      expect(promote[0].targetMaturity).toBe('verified');
      expect(promote[0].risk).toBe('low');
      expect(promote[0].autoApprovable).toBe(true);
    });

    it('draft 无引用时不提议升级', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ maturity: 'draft', referencedBy: [] });
      const proposals = evolver.generateProposals([entry]);
      expect(proposals.filter(p => p.action === 'promote')).toHaveLength(0);
    });

    it('verified 有足够项目验证时提议升级为 proven', () => {
      const evolver = new KnowledgeEvolver({ promoteThreshold: 2 });
      const entry = makeEntry({ maturity: 'verified', projects: ['p1', 'p2'] });
      const proposals = evolver.generateProposals([entry]);
      const promote = proposals.filter(p => p.action === 'promote');
      expect(promote).toHaveLength(1);
      expect(promote[0].targetMaturity).toBe('proven');
    });

    it('verified 项目数不足时不提议升级', () => {
      const evolver = new KnowledgeEvolver({ promoteThreshold: 5 });
      const entry = makeEntry({ maturity: 'verified', projects: ['p1'] });
      const proposals = evolver.generateProposals([entry]);
      expect(proposals.filter(p => p.action === 'promote')).toHaveLength(0);
    });

    it('proven 不会提议升级（已到顶）', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ maturity: 'proven', referencedBy: ['r1', 'r2'], projects: ['p1', 'p2'] });
      const proposals = evolver.generateProposals([entry]);
      expect(proposals.filter(p => p.action === 'promote')).toHaveLength(0);
    });
  });

  describe('降级提案', () => {
    it('长期未引用的 verified 提议降级', () => {
      const evolver = new KnowledgeEvolver({ demoteDays: 30 });
      const entry = makeEntry({
        maturity: 'verified',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const proposals = evolver.generateProposals([entry]);
      const demote = proposals.filter(p => p.action === 'demote');
      expect(demote).toHaveLength(1);
      expect(demote[0].targetMaturity).toBe('draft');
    });

    it('长期未引用的 proven 提议降级为 verified', () => {
      const evolver = new KnowledgeEvolver({ demoteDays: 30 });
      const entry = makeEntry({
        maturity: 'proven',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const proposals = evolver.generateProposals([entry]);
      const demote = proposals.filter(p => p.action === 'demote');
      expect(demote).toHaveLength(1);
      expect(demote[0].targetMaturity).toBe('verified');
    });

    it('draft 不会提议降级（已到底）', () => {
      const evolver = new KnowledgeEvolver({ demoteDays: 1 });
      const entry = makeEntry({
        maturity: 'draft',
        lastReferenced: '2020-01-01T00:00:00Z',
      });
      const proposals = evolver.generateProposals([entry]);
      expect(proposals.filter(p => p.action === 'demote')).toHaveLength(0);
    });

    it('近期有引用的不提议降级', () => {
      const evolver = new KnowledgeEvolver({ demoteDays: 180 });
      const entry = makeEntry({ maturity: 'verified' });
      const proposals = evolver.generateProposals([entry]);
      expect(proposals.filter(p => p.action === 'demote')).toHaveLength(0);
    });
  });

  describe('archived 条目', () => {
    it('跳过 archived 条目', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ maturity: 'archived' });
      const proposals = evolver.generateProposals([entry]);
      expect(proposals).toHaveLength(0);
    });
  });

  describe('矛盾诊断 → freeze 提案', () => {
    it('从矛盾诊断生成 freeze 提案', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ id: 'e1', maturity: 'verified' });
      const diagnosis: KnowledgeDiagnosis = {
        id: 'd1',
        type: 'contradiction',
        severity: 'high',
        entryId: 'e1',
        title: 'Contradiction',
        description: 'Conflicting entries',
        rootCause: 'Same tag different maturity',
        impact: 'Confusion',
        recommendations: ['Freeze'],
        timestamp: new Date().toISOString(),
      };
      const proposals = evolver.generateProposals([entry], [diagnosis]);
      const freeze = proposals.filter(p => p.action === 'freeze');
      expect(freeze).toHaveLength(1);
      expect(freeze[0].risk).toBe('medium');
      expect(freeze[0].autoApprovable).toBe(false);
    });

    it('无 entryId 的矛盾诊断不生成提案', () => {
      const evolver = new KnowledgeEvolver();
      const diagnosis: KnowledgeDiagnosis = {
        id: 'd1',
        type: 'contradiction',
        severity: 'high',
        title: 'Contradiction',
        description: 'Conflicting entries',
        rootCause: 'Unknown',
        impact: 'Unknown',
        recommendations: [],
        timestamp: new Date().toISOString(),
      };
      const proposals = evolver.generateProposals([], [diagnosis]);
      expect(proposals).toHaveLength(0);
    });
  });

  describe('审核', () => {
    it('低风险自动通过提案自动批准', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ maturity: 'draft', referencedBy: ['r1'] });
      const proposals = evolver.generateProposals([entry]);
      const result = evolver.review(proposals[0]);
      expect(result.approved).toBe(true);
    });

    it('proven 直接归档被拒绝', () => {
      const evolver = new KnowledgeEvolver();
      const proposal = {
        id: 'p1',
        entryId: 'e1',
        action: 'archive' as const,
        currentMaturity: 'proven' as const,
        targetMaturity: 'archived' as const,
        reason: 'test',
        evidence: [],
        risk: 'low' as const,
        autoApprovable: true,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      const result = evolver.review(proposal);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('proven');
    });

    it('高风险升级被拒绝', () => {
      const evolver = new KnowledgeEvolver();
      const proposal = {
        id: 'p1',
        entryId: 'e1',
        action: 'promote' as const,
        currentMaturity: 'draft' as const,
        targetMaturity: 'verified' as const,
        reason: 'test',
        evidence: [],
        risk: 'high' as const,
        autoApprovable: false,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      const result = evolver.review(proposal);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('高风险');
    });

    it('中等风险提案通过审核', () => {
      const evolver = new KnowledgeEvolver();
      const proposal = {
        id: 'p1',
        entryId: 'e1',
        action: 'freeze' as const,
        currentMaturity: 'verified' as const,
        targetMaturity: 'verified' as const,
        reason: 'test',
        evidence: [],
        risk: 'medium' as const,
        autoApprovable: false,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      const result = evolver.review(proposal);
      expect(result.approved).toBe(true);
      expect(result.reason).toBe('提案通过审核');
    });
  });

  describe('执行提案', () => {
    it('无 store 时返回 false', () => {
      const evolver = new KnowledgeEvolver();
      const proposal = {
        id: 'p1',
        entryId: 'e1',
        action: 'promote' as const,
        currentMaturity: 'draft' as const,
        targetMaturity: 'verified' as const,
        reason: 'test',
        evidence: [],
        risk: 'low' as const,
        autoApprovable: true,
        status: 'approved' as const,
        createdAt: new Date().toISOString(),
      };
      expect(evolver.implement(proposal)).toBe(false);
    });

    it('非 approved 状态返回 false', () => {
      const evolver = new KnowledgeEvolver();
      const proposal = {
        id: 'p1',
        entryId: 'e1',
        action: 'promote' as const,
        currentMaturity: 'draft' as const,
        targetMaturity: 'verified' as const,
        reason: 'test',
        evidence: [],
        risk: 'low' as const,
        autoApprovable: true,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      expect(evolver.implement(proposal)).toBe(false);
    });

    it('store 中不存在条目时返回 false', () => {
      const mockStore = { get: () => undefined, update: jest.fn() };
      const evolver = new KnowledgeEvolver({}, mockStore as any);
      const proposal = {
        id: 'p1', entryId: 'e1', action: 'promote' as const,
        currentMaturity: 'draft' as const, targetMaturity: 'verified' as const,
        reason: 'test', evidence: [], risk: 'low' as const,
        autoApprovable: true, status: 'approved' as const,
        createdAt: new Date().toISOString(),
      };
      expect(evolver.implement(proposal)).toBe(false);
    });

    it('archive 操作执行成功', () => {
      const mockStore = { get: () => makeEntry(), update: jest.fn() };
      const evolver = new KnowledgeEvolver({}, mockStore as any);
      const proposal = {
        id: 'p1', entryId: 'entry-1', action: 'archive' as const,
        currentMaturity: 'draft' as const, targetMaturity: 'archived' as const,
        reason: 'test', evidence: [], risk: 'low' as const,
        autoApprovable: true, status: 'approved' as const,
        createdAt: new Date().toISOString(),
      };
      expect(evolver.implement(proposal)).toBe(true);
      expect(mockStore.update).toHaveBeenCalledWith('entry-1', { maturity: 'archived' });
      expect(proposal.status).toBe('implemented');
    });

    it('freeze 操作不调用 update', () => {
      const mockStore = { get: () => makeEntry(), update: jest.fn() };
      const evolver = new KnowledgeEvolver({}, mockStore as any);
      const proposal = {
        id: 'p1', entryId: 'entry-1', action: 'freeze' as const,
        currentMaturity: 'verified' as const, targetMaturity: 'verified' as const,
        reason: 'test', evidence: [], risk: 'medium' as const,
        autoApprovable: false, status: 'approved' as const,
        createdAt: new Date().toISOString(),
      };
      expect(evolver.implement(proposal)).toBe(true);
      expect(mockStore.update).not.toHaveBeenCalled();
      expect(proposal.status).toBe('implemented');
    });

    it('未知 action 返回 false', () => {
      const mockStore = { get: () => makeEntry(), update: jest.fn() };
      const evolver = new KnowledgeEvolver({}, mockStore as any);
      const proposal = {
        id: 'p1', entryId: 'entry-1', action: 'merge' as const,
        currentMaturity: 'draft' as const, targetMaturity: 'verified' as const,
        reason: 'test', evidence: [], risk: 'low' as const,
        autoApprovable: true, status: 'approved' as const,
        createdAt: new Date().toISOString(),
      };
      expect(evolver.implement(proposal)).toBe(false);
    });
  });

  describe('批量处理', () => {
    it('processProposals 审核并生成报告', () => {
      const evolver = new KnowledgeEvolver();
      const entry = makeEntry({ maturity: 'draft', referencedBy: ['r1'] });
      const proposals = evolver.generateProposals([entry]);
      const report = evolver.processProposals(proposals);
      expect(report.proposals.length).toBeGreaterThan(0);
      expect(report.proposals[0].status).toBe('approved');
      expect(report.summary).toBeDefined();
    });

    it('processProposals 拒绝高风险提案', () => {
      const evolver = new KnowledgeEvolver();
      const proposal = {
        id: 'p1', entryId: 'e1', action: 'promote' as const,
        currentMaturity: 'draft' as const, targetMaturity: 'verified' as const,
        reason: 'test', evidence: [], risk: 'high' as const,
        autoApprovable: false, status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };
      const report = evolver.processProposals([proposal]);
      expect(report.proposals[0].status).toBe('rejected');
    });

    it('autoImplement 模式自动执行低风险提案', () => {
      const mockStore = {
        get: (id: string) => makeEntry({ id, maturity: 'draft' }),
        update: jest.fn(),
      };
      const evolver = new KnowledgeEvolver({ autoImplement: true }, mockStore as any);
      const entry = makeEntry({ maturity: 'draft', referencedBy: ['r1'] });
      const proposals = evolver.generateProposals([entry]);
      const report = evolver.processProposals(proposals);
      const promote = report.proposals.find(p => p.action === 'promote');
      if (promote?.autoApprovable) {
        expect(promote.status).toBe('implemented');
      }
    });
  });
});
