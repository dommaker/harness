/**
 * KnowledgeIngest.validateEntry 测试（ADR-0040 Phase 4：原 KnowledgeLinter.validateEntry
 * 的保种落点——lint.ts 随 audit 正本收口删除，摄入前单条校验并入 ingest）
 */

import { FileKnowledgeStore as KnowledgeStore } from '../store';
import { KnowledgeIngest } from '../ingest';
import type { KnowledgeEntry } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('KnowledgeIngest.validateEntry', () => {
  let store: KnowledgeStore;
  let ingest: KnowledgeIngest;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-validate-test-'));
    store = new KnowledgeStore({ baseDir: path.join(tmpDir, 'knowledge') });
    ingest = new KnowledgeIngest(store);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function saveEntry(overrides: Partial<KnowledgeEntry> = {}) {
    store.save({
      id: overrides.id || `test-${Math.random().toString(36).slice(2, 6)}`,
      type: 'decision',
      title: 'Test Decision',
      content: 'Some content',
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
      executionResults: [],
      consumptionMode: 'reference',
      origin: 'agent',
      ...overrides,
    });
  }

  it('rejects content shorter than 20 characters', () => {
    const issues = ingest.validateEntry({ title: 'Short', content: 'tiny', tags: [], type: 'decision' });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('high');
    expect(issues[0].description).toContain('Content too short');
  });

  it('flags vague Chinese titles', () => {
    const issues = ingest.validateEntry({
      title: '错误',
      content: 'This is a sufficiently long content for the test.',
      tags: [],
      type: 'decision',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toContain('too vague');
  });

  it('flags vague English titles', () => {
    const issues = ingest.validateEntry({
      title: 'bug',
      content: 'This is a sufficiently long content for the test to pass length check.',
      tags: [],
      type: 'decision',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('medium');
  });

  it('passes valid entries without issues', () => {
    const issues = ingest.validateEntry({
      title: 'Specific Root Cause Analysis for performance',
      content: 'This is a sufficiently long content for the test to pass all checks.',
      tags: ['performance'],
      type: 'decision',
    });
    expect(issues).toHaveLength(0);
  });

  it('detects contradictions with proven entries sharing 2+ tags', () => {
    saveEntry({
      id: 'proven-validate',
      title: 'Proven Fact',
      maturity: 'proven',
      tags: ['database', 'performance', 'optimization'],
    });

    const issues = ingest.validateEntry({
      title: 'New Claim',
      content: 'This is a valid length content for testing purposes here.',
      tags: ['database', 'performance', 'indexing'],
      type: 'decision',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toContain('Contradiction risk');
  });

  it('does not detect contradiction when sharing only 1 tag', () => {
    saveEntry({
      id: 'proven-single-tag',
      title: 'Proven',
      maturity: 'proven',
      tags: ['database'],
    });

    const issues = ingest.validateEntry({
      title: 'New Claim',
      content: 'This is a valid length content for testing purposes.',
      tags: ['database', 'caching'],
      type: 'decision',
    });
    expect(issues.filter(i => i.description.includes('Contradiction risk'))).toHaveLength(0);
  });

  it('detects exact title duplicates', () => {
    saveEntry({ id: 'existing-entry', title: 'Unique Title', maturity: 'verified' });

    const issues = ingest.validateEntry({
      title: 'Unique Title',
      content: 'This is a sufficiently long content for the duplicate check test case.',
      tags: [],
      type: 'decision',
    });
    expect(issues.filter(i => i.description.includes('Exact title match'))).toHaveLength(1);
  });

  it('skips non-proven entries in contradiction check', () => {
    saveEntry({ id: 'non-proven', title: 'Non Proven', maturity: 'draft', tags: ['auth'] });

    const issues = ingest.validateEntry({
      title: 'New Claim Check',
      content: 'This is a sufficiently long content for testing here.',
      tags: ['auth'],
      type: 'decision',
    });
    expect(issues.filter(i => i.description.includes('Contradiction risk'))).toHaveLength(0);
  });

  it('skips different type in contradiction check', () => {
    saveEntry({ id: 'proven-diff-type', title: 'Proven Fact', maturity: 'proven', tags: ['database'], type: 'guideline' });

    const issues = ingest.validateEntry({
      title: 'New Database Claim',
      content: 'This is a sufficiently long content for testing purposes here.',
      tags: ['database'],
      type: 'decision',
    });
    expect(issues.filter(i => i.description.includes('Contradiction risk'))).toHaveLength(0);
  });

  it('skips entry when title matches existing id', () => {
    saveEntry({ id: 'New Feature Implementation', title: 'Existing Feature', maturity: 'verified' });

    const issues = ingest.validateEntry({
      title: 'New Feature Implementation',
      content: 'This is a sufficiently long content for testing purposes here.',
      tags: [],
      type: 'decision',
    });
    // Should not produce duplicate issue by matching against itself via id
    expect(issues.filter(i => i.description.includes('title match') || i.description.includes('Title similarity'))).toHaveLength(0);
  });

  it('detects title containment similarity', () => {
    saveEntry({ id: 'base-entry', title: 'My Feature', maturity: 'verified' });

    const issues = ingest.validateEntry({
      title: 'Add My Feature Implementation',
      content: 'This is a sufficiently long content for the containment check test case.',
      tags: [],
      type: 'decision',
    });
    expect(issues.some(i => i.description.includes('Title similarity'))).toBe(true);
  });

  // E1 复盘修正 M1：maturity/layer 枚举值域校验（实盘脏值：pending/canonical/L3_tool_behavior）
  it('flags undeclared maturity value', () => {
    const issues = ingest.validateEntry({
      title: 'Specific Entry With Valid Title',
      content: 'This is a sufficiently long content for the enum check test case.',
      tags: [],
      type: 'decision',
      maturity: 'pending',
    });
    const issue = issues.find(i => i.description.includes('maturity'));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('high');
    expect(issue!.description).toContain('pending');
  });

  it('flags undeclared layer value', () => {
    const issues = ingest.validateEntry({
      title: 'Specific Entry With Valid Title',
      content: 'This is a sufficiently long content for the enum check test case.',
      tags: [],
      type: 'decision',
      layer: 'L3_tool_behavior',
    });
    const issue = issues.find(i => i.description.includes('layer'));
    expect(issue).toBeDefined();
    expect(issue!.description).toContain('L3_tool_behavior');
  });

  it('accepts declared maturity/layer values', () => {
    const issues = ingest.validateEntry({
      title: 'Specific Entry With Valid Title',
      content: 'This is a sufficiently long content for the enum check test case.',
      tags: [],
      type: 'decision',
      maturity: 'verified',
      layer: 'project',
    });
    expect(issues.filter(i => i.description.includes('not a declared value'))).toHaveLength(0);
  });

  it('skips enum check when maturity/layer are not provided (pre-ingest caller compat)', () => {
    const issues = ingest.validateEntry({
      title: 'Specific Entry With Valid Title',
      content: 'This is a sufficiently long content for the enum check test case.',
      tags: [],
      type: 'decision',
    });
    expect(issues.filter(i => i.description.includes('not a declared value'))).toHaveLength(0);
  });
});
