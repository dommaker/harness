/**
 * KnowledgeIngest 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { KnowledgeStore } from '../store';
import { KnowledgeIngest } from '../ingest';
import * as fs from 'fs';
import * as path from 'path';

describe('KnowledgeIngest', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-ingest');
  let store: KnowledgeStore;
  let ingest: KnowledgeIngest;

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
    const files = fs.readdirSync(tempDir);
    for (const f of files) {
      fs.unlinkSync(path.join(tempDir, f));
    }
    store = new KnowledgeStore({ baseDir: tempDir });
    ingest = new KnowledgeIngest(store);
  });

  describe('ingestEntry', () => {
    it('should ingest a new entry with auto-generated id', () => {
      const entry = ingest.ingestEntry(
        { title: 'Test', content: 'Content', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toMatch(/^DEC-\d{3}$/);
      expect(entry.title).toBe('Test');
      expect(entry.maturity).toBe('draft');
    });

    it('should use provided id', () => {
      const entry = ingest.ingestEntry(
        { id: 'CUSTOM-001', title: 'Test', type: 'guideline' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.id).toBe('CUSTOM-001');
    });

    it('should merge tags from options and entry', () => {
      const entry = ingest.ingestEntry(
        { title: 'Test', type: 'decision', tags: ['arch'] },
        { source: 'test', layer: 'project', tags: ['db'] },
      );
      expect(entry.tags).toContain('arch');
      expect(entry.tags).toContain('db');
    });

    it('should use maturity from options', () => {
      const entry = ingest.ingestEntry(
        { title: 'Test', type: 'decision' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      expect(entry.maturity).toBe('verified');
    });

    it('should merge duplicate entries', () => {
      ingest.ingestEntry(
        { title: 'Duplicate', content: 'Original', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      const merged = ingest.ingestEntry(
        { title: 'Duplicate', content: 'Updated', type: 'decision', contributors: ['alice'] },
        { source: 'test', layer: 'project' },
      );
      expect(merged.content).toBe('Updated');
      expect(merged.contributors).toContain('alice');
      // Should only have one entry in the store
      expect(store.list()).toHaveLength(1);
    });

    it('should use incoming maturity when merging duplicate entries', () => {
      // First ingest creates entry with default maturity (draft)
      const first = ingest.ingestEntry(
        { title: 'MaturityTest', content: 'Original', type: 'pitfall' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      expect(first.maturity).toBe('verified');

      // Second ingest merges with explicit draft maturity (LLM extraction scenario)
      const merged = ingest.ingestEntry(
        { title: 'MaturityTest', content: 'Updated content', type: 'pitfall' },
        { source: 'test', layer: 'project', maturity: 'draft' },
      );
      expect(merged.maturity).toBe('draft');
      expect(store.list()).toHaveLength(1);
    });

    it('should preserve existing maturity when incoming has no explicit maturity', () => {
      ingest.ingestEntry(
        { title: 'PreserveTest', content: 'Original', type: 'guideline' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      const merged = ingest.ingestEntry(
        { title: 'PreserveTest', content: 'Updated', type: 'guideline' },
        { source: 'test', layer: 'project' },
      );
      expect(merged.maturity).toBe('verified');
    });
  });

  describe('ingestBatch', () => {
    it('should ingest multiple entries', () => {
      const entries = ingest.ingestBatch(
        [
          { title: 'First', type: 'decision' },
          { title: 'Second', type: 'pitfall' },
        ],
        { source: 'test', layer: 'project' },
      );
      expect(entries).toHaveLength(2);
      expect(store.list()).toHaveLength(2);
    });
  });

  describe('findDuplicate reads from disk (A1)', () => {
    it('should find duplicate even when index.json is stale', () => {
      // Create an entry normally (writes to disk + index)
      ingest.ingestEntry(
        { title: 'Disk Dedup Test', content: 'Original', type: 'decision' },
        { source: 'test', layer: 'project' },
      );

      // Corrupt index.json to simulate stale index
      const indexPath = path.join(tempDir, 'index.json');
      fs.writeFileSync(indexPath, '[]', 'utf-8');

      // Ingest same title again — should still find the duplicate on disk
      const merged = ingest.ingestEntry(
        { title: 'Disk Dedup Test', content: 'Updated', type: 'decision' },
        { source: 'test', layer: 'project' },
      );

      // Should merge into existing entry, not create a second one
      expect(merged.content).toBe('Updated');
      // Count .md files on disk (excluding index.json)
      const mdFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
      expect(mdFiles).toHaveLength(1);
    });
  });

  describe('sourceReferences cap at 20 (A2)', () => {
    it('should cap sourceReferences to MAX_SOURCE_REFS when merging', () => {
      // Create entry with 15 sourceReferences
      const refs15 = Array.from({ length: 15 }, (_, i) => ({
        workflow: `workflow-${i}`,
        timestamp: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }));
      store.save({
        id: 'REF-001',
        type: 'decision',
        title: 'Ref Cap Test',
        content: 'Original',
        maturity: 'draft',
        layer: 'project',
        created: '2026-05-01T00:00:00.000Z',
        lastReferenced: '',
        contributors: [],
        projects: [],
        tags: [],
        applicablePhases: [],
        sourceReferences: refs15,
        referencedBy: [],
      });

      // Ingest duplicate with 10 more sourceReferences
      const refs10 = Array.from({ length: 10 }, (_, i) => ({
        workflow: `new-workflow-${i}`,
        timestamp: `2026-05-${String(i + 16).padStart(2, '0')}T00:00:00.000Z`,
      }));
      ingest.ingestEntry(
        { id: 'REF-001', title: 'Ref Cap Test', type: 'decision', sourceReferences: refs10 },
        { source: 'test', layer: 'project' },
      );

      const entry = store.get('REF-001');
      expect(entry!.sourceReferences.length).toBeLessThanOrEqual(20);
      // 15 + 10 = 25, but capped to last 20
      expect(entry!.sourceReferences).toHaveLength(20);
      // Should keep the most recent ones (slice(-20) from 25)
      expect(entry!.sourceReferences[0].workflow).toBe('workflow-5');
      expect(entry!.sourceReferences[19].workflow).toBe('new-workflow-9');
    });
  });

  describe('pitfall dedup (#3)', () => {
    it('should detect duplicate pitfall by content window containment', () => {
      // Same root cause, different titles — like real PIT-002 / PIT-mppq8n44-1829
      // Content is body text only (no frontmatter) — same format as system-produced entries
      store.save({
        id: 'PIT-001', type: 'pitfall', title: 'events-daemon 与 API 端口不匹配',
        content: '根因：events-daemon 默认使用 3001 端口连接 API，但实际 API 运行在 13101 端口，导致 session:archive 事件无法被正确接收和处理。责任归属：开发流程缺乏端口一致性校验机制。',
        maturity: 'verified', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
      });

      // Different title, same root cause content → should merge
      const merged = ingest.ingestEntry(
        {
          title: '端口不匹配导致事件处理失败',
          content: '根因：events-daemon 默认使用 3001 端口连接 API，但实际 API 运行在 13101 端口。责任：启动配置未显式指定 API_PORT 环境变量。',
          type: 'pitfall',
        },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(1);
      expect(merged.id).toBe('PIT-001');
    });

    it('should detect duplicate pitfall by title substring after normalization', () => {
      store.save({
        id: 'PIT-010', type: 'pitfall', title: '[Analyst] API 超时导致请求失败',
        content: 'some content here that is long enough for prefix comparison purposes and more',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
      });

      // After stripping [prefix], normalizing: "api超时导致请求失败" contains "api超时导致"
      const merged = ingest.ingestEntry(
        { title: '[Triage Fix] API 超时导致', content: 'different content but same issue', type: 'pitfall' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(1);
    });

    it('should NOT merge pitfall entries with different root causes', () => {
      store.save({
        id: 'PIT-020', type: 'pitfall', title: '端口不匹配导致事件处理失败',
        content: '根因：events-daemon 默认使用 3001 端口连接 API，但实际 API 运行在 13101 端口。',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
      });

      // Completely different root cause → should NOT merge
      ingest.ingestEntry(
        { title: '数据库连接池耗尽', content: '根因：连接池大小为 10，高并发时全部占满。', type: 'pitfall' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(2);
    });

    it('should detect duplicate by title keyword overlap >= 60%', () => {
      store.save({
        id: 'PIT-030', type: 'pitfall', title: 'Prisma 连接超时导致 API 请求失败',
        content: 'Some content about Prisma connection timeout issues',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
      });

      // Keywords: prisma, 连接, 超时, 导致, api, 请求, 失败
      // Incoming: prisma, 超时, 请求, 失败 → 4/7 overlap
      const merged = ingest.ingestEntry(
        { title: 'Prisma 超时导致请求失败', content: 'totally different content', type: 'pitfall' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['pitfall'] })).toHaveLength(1);
    });

    it('should apply semantic dedup to non-pitfall types', () => {
      store.save({
        id: 'GUI-001', type: 'guideline', title: 'events-daemon 端口不匹配导致事件处理失败',
        content: '根因：events-daemon 默认使用 3001 端口连接 API',
        maturity: 'draft', layer: 'system',
        created: '2026-05-28T00:00:00.000Z', lastReferenced: '',
        contributors: [], projects: [], tags: [], applicablePhases: [],
        sourceReferences: [], referencedBy: [],
      });

      // Title substring match (>= 6 chars) — should detect as duplicate
      ingest.ingestEntry(
        { title: 'events-daemon 端口不匹配', content: 'shorter title', type: 'guideline' },
        { source: 'test', layer: 'system' },
      );
      expect(store.list({ types: ['guideline'] })).toHaveLength(1);
    });
  });

  describe('audit quality gate', () => {
    it('should archive entry with test-scope tags', () => {
      ingest.ingestEntry(
        { title: 'TestEntry', type: 'guideline', tags: ['test-scope-abc'], content: 'real content here' },
        { source: 'test', layer: 'project' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      expect(saved[0].maturity).toBe('archived');
    });

    it('should demote zero-content proven entry to draft', () => {
      ingest.ingestEntry(
        { title: 'ZeroProven', type: 'guideline', content: 'tiny', maturity: 'proven' as any },
        { source: 'test', layer: 'project' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      expect(saved[0].maturity).toBe('draft');
    });

    it('should skip demote when options.maturity is explicitly set', () => {
      ingest.ingestEntry(
        { title: 'ExplicitMaturity', type: 'guideline', content: 'tiny' },
        { source: 'test', layer: 'project', maturity: 'verified' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      // Should stay verified — audit demote skipped because maturity was explicit
      expect(saved[0].maturity).toBe('verified');
    });

    it('should flag short-content entry with low_quality tag', () => {
      ingest.ingestEntry(
        { title: 'ShortContent', type: 'guideline', content: 'a'.repeat(30) },
        { source: 'test', layer: 'project' },
      );
      const saved = store.list({ excludeArchived: false });
      expect(saved).toHaveLength(1);
      expect(saved[0].tags).toContain('low_quality');
    });
  });

  describe('edge cases', () => {
    it('should default to guideline type when type is not provided', () => {
      const entry = ingest.ingestEntry(
        { title: 'No Type' },
        { source: 'test', layer: 'project' },
      );
      expect(entry.type).toBe('guideline');
    });

    it('should dedup case-insensitively', () => {
      ingest.ingestEntry(
        { title: 'My Decision', type: 'decision' },
        { source: 'test', layer: 'project' },
      );
      const merged = ingest.ingestEntry(
        { title: 'my decision', type: 'decision', content: 'updated' },
        { source: 'test', layer: 'project' },
      );
      expect(merged.content).toBe('updated');
      expect(store.list()).toHaveLength(1);
    });
  });
});
