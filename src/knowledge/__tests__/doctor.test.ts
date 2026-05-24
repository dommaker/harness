/**
 * KnowledgeHealthScorer 测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeStore } from '../store';
import { KnowledgeLinter, type LintReport } from '../lint';
import { ReferenceTracker } from '../reference-tracker';
import { KnowledgeHealthScorer } from '../doctor';
import type { KnowledgeEntry, IndexEntry } from '../types';

describe('KnowledgeHealthScorer', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-knowledge-doctor');
  let store: KnowledgeStore;
  let tracker: ReferenceTracker;
  let linter: KnowledgeLinter;
  let scorer: KnowledgeHealthScorer;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    // Clean knowledge directory before each test
    try {
      const knowledgeDir = path.join(tempDir, '.harness', 'knowledge');
      if (fs.existsSync(knowledgeDir)) {
        fs.rmSync(knowledgeDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }

    store = new KnowledgeStore({ baseDir: path.join(tempDir, '.harness', 'knowledge') });
    tracker = new ReferenceTracker(store, path.join(tempDir, '.harness', 'knowledge'));
    linter = new KnowledgeLinter(store, tracker);
    scorer = new KnowledgeHealthScorer(store, linter);
  });

  describe('healthScore', () => {
    it('空知识库应该返回 100 分', () => {
      const report = scorer.healthScore();

      expect(report.score).toBe(100);
      expect(report.totalEntries).toBe(0);
      expect(report.details.length).toBe(1);
      expect(report.details[0].category).toBe('empty');
    });

    it('健康的知识库应该返回 100 分', () => {
      const entry: KnowledgeEntry = {
        id: 'healthy-001',
        type: 'decision',
        title: 'Good Decision',
        content: 'This is a healthy decision entry.',
        maturity: 'proven',
        layer: 'project',
        created: new Date().toISOString(),
        lastReferenced: new Date().toISOString(),
        contributors: ['user1'],
        projects: ['harness'],
        tags: ['architecture'],
        applicablePhases: ['design'],
        sourceReferences: [],
        referencedBy: ['decision-1'],
      };
      store.save(entry);

      const report = scorer.healthScore();

      expect(report.score).toBe(100);
      expect(report.totalEntries).toBe(1);
      expect(report.timestamp).toBeDefined();
    });

    it('孤儿条目超过 10% 应该扣 20 分', () => {
      // Save entries — all will be orphans (no references, no contributors, no projects)
      for (let i = 0; i < 5; i++) {
        store.save({
          id: `orphan-${i}`,
          type: 'decision',
          title: `Orphan Entry ${i}`,
          content: `Orphan content ${i}`,
          maturity: 'draft',
          layer: 'project',
          created: new Date().toISOString(),
          lastReferenced: '',
          contributors: [],
          projects: [],
          tags: [],
          applicablePhases: [],
          sourceReferences: [],
          referencedBy: [],
        });
      }

      const report = scorer.healthScore();

      expect(report.score).toBeLessThan(100);
      const orphanDetail = report.details.find(d => d.category === 'orphans');
      expect(orphanDetail).toBeDefined();
      expect(orphanDetail!.score).toBe(-20);
    });

    it('过时条目超过 5% 应该扣 15 分', () => {
      // Save entries that are 7 months old (outdated)
      const sevenMonthsAgo = new Date();
      sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
      const dateStr = sevenMonthsAgo.toISOString();

      // Save 3 outdated + many healthy ones to keep orphan rate low
      for (let i = 0; i < 3; i++) {
        store.save({
          id: `outdated-${i}`,
          type: 'decision',
          title: `Old Entry ${i}`,
          content: `Old content ${i}`,
          maturity: 'draft',
          layer: 'project',
          created: dateStr,
          lastReferenced: dateStr,
          contributors: ['user1'],
          projects: ['harness'],
          tags: ['test'],
          applicablePhases: [],
          sourceReferences: [],
          referencedBy: ['decision-ref'],
        });
      }
      // Save healthy entries to keep ratios manageable (3 outdated out of ~56 = ~5.3%)
      for (let i = 0; i < 53; i++) {
        store.save({
          id: `healthy-${i}`,
          type: 'decision',
          title: `Healthy Entry ${i}`,
          content: `Content ${i}`,
          maturity: 'proven',
          layer: 'project',
          created: new Date().toISOString(),
          lastReferenced: new Date().toISOString(),
          contributors: ['user1'],
          projects: ['harness'],
          tags: ['test'],
          applicablePhases: [],
          sourceReferences: [],
          referencedBy: ['decision-ref'],
        });
      }

      const report = scorer.healthScore();
      const outdatedDetail = report.details.find(d => d.category === 'outdated');
      expect(outdatedDetail).toBeDefined();
      expect(outdatedDetail!.score).toBe(-15);
    });

    it('重复条目超过 5% 应该扣 25 分', () => {
      // Save 4 entries with duplicate title+type pairs
      store.save({
        id: 'dup-1',
        type: 'decision',
        title: 'Duplicate Title',
        content: 'Content 1',
        maturity: 'draft',
        layer: 'project',
        created: new Date().toISOString(),
        lastReferenced: new Date().toISOString(),
        contributors: ['user1'],
        projects: ['harness'],
        tags: ['test'],
        applicablePhases: [],
        sourceReferences: [],
        referencedBy: ['decision-ref'],
      });
      store.save({
        id: 'dup-2',
        type: 'decision',
        title: 'Duplicate Title',  // Same title + type → duplicate
        content: 'Content 2',
        maturity: 'draft',
        layer: 'project',
        created: new Date().toISOString(),
        lastReferenced: new Date().toISOString(),
        contributors: ['user1'],
        projects: ['harness'],
        tags: ['test'],
        applicablePhases: [],
        sourceReferences: [],
        referencedBy: ['decision-ref'],
      });

      const report = scorer.healthScore();
      const dupDetail = report.details.find(d => d.category === 'duplicates');
      expect(dupDetail).toBeDefined();
      expect(dupDetail!.score).toBe(-25);
    });

    it('存在矛盾条目应该扣分', () => {
      // Save proven and draft entries with same tags (potential contradiction)
      store.save({
        id: 'proven-entry',
        type: 'decision',
        title: 'Proven Decision',
        content: 'This is proven.',
        maturity: 'proven',
        layer: 'project',
        created: new Date().toISOString(),
        lastReferenced: new Date().toISOString(),
        contributors: ['user1'],
        projects: ['harness'],
        tags: ['architecture', 'pattern'],
        applicablePhases: [],
        sourceReferences: [],
        referencedBy: ['decision-ref'],
      });
      store.save({
        id: 'draft-entry',
        type: 'decision',
        title: 'Draft Decision',
        content: 'This is draft.',
        maturity: 'draft',
        layer: 'project',
        created: new Date().toISOString(),
        lastReferenced: new Date().toISOString(),
        contributors: ['user1'],
        projects: ['harness'],
        tags: ['architecture', 'pattern'],
        applicablePhases: [],
        sourceReferences: [],
        referencedBy: ['decision-ref'],
      });

      const report = scorer.healthScore();
      const contradictionDetail = report.details.find(d => d.category === 'contradictions');
      expect(contradictionDetail).toBeDefined();
      expect(contradictionDetail!.score).toBeLessThan(0);
    });

    it('总分最低为 0', () => {
      // Create 2 entries with many issues: orphans (high rate), duplicates, etc.
      for (let i = 0; i < 2; i++) {
        store.save({
          id: `bad-${i}`,
          type: 'decision',
          title: 'Bad Title',
          content: `Bad content ${i}`,
          maturity: 'draft',
          layer: 'project',
          created: new Date().toISOString(),
          lastReferenced: '',
          contributors: [],
          projects: [],
          tags: ['issue'],
          applicablePhases: [],
          sourceReferences: [],
          referencedBy: [],
        });
      }

      const report = scorer.healthScore();
      expect(report.score).toBeGreaterThanOrEqual(0);
    });
  });
});
