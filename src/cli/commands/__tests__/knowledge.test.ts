/**
 * knowledge 命令测试 — knowledgeAudit
 */

import { knowledgeAudit, knowledgeStats, knowledgeHealth } from '../knowledge';

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  bold: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
}));

// Mock KnowledgeAudit
const mockRun = jest.fn();
jest.mock('../../../knowledge/audit', () => ({
  KnowledgeAudit: jest.fn().mockImplementation(() => ({
    run: mockRun,
  })),
}));

const MOCK_REPORT = {
  timestamp: '2026-06-02T00:00:00.000Z',
  totalEntries: 100,
  issues: [
    {
      rule: 'short-content',
      entryId: 'GUI-001',
      title: 'Short Entry',
      severity: 'medium',
      action: 'flag',
      detail: 'content 30 chars',
    },
  ],
  summary: {
    'frontmatter-missing': 0,
    'test-data-pollution': 0,
    'daily-audit-noise': 0,
    'zero-content-proven': 0,
    'short-content': 1,
    'maturity-inflation': 0,
    'title-duplicate': 0,
    'source-refs-bloat': 0,
    'promotion-blocked': 0,
    'orphan-draft': 0,
    'stale-entry': 0,
  },
  dimensions: {
    structure: { score: 100, issues: 0, details: {} },
    content: { score: 95, issues: 1, details: {} },
    dedup: { score: 100, issues: 0, details: {} },
    maturity: { score: 100, issues: 0, details: {} },
    freshness: { score: 100, issues: 0, details: {} },
    flywheel: { score: 50, issues: 0, details: {} },
  },
  autoFixed: 0,
  healthScore: { before: 95, after: 95 },
};

describe('getKnowledgeDir', () => {
  const os = require('os');
  const path = require('path');
  const storeModule = require('../../../knowledge/store');
  let storeCtorSpy: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.KNOWLEDGE_BASE_DIR;
    storeCtorSpy = jest.spyOn(storeModule, 'FileKnowledgeStore').mockImplementation(() => ({
      list: jest.fn().mockReturnValue([]),
    }));
  });

  afterEach(() => {
    storeCtorSpy.mockRestore();
    delete process.env.KNOWLEDGE_BASE_DIR;
  });

  it('should use KNOWLEDGE_BASE_DIR env var when set', async () => {
    process.env.KNOWLEDGE_BASE_DIR = '/custom/knowledge';
    await knowledgeStats({ json: true });
    expect(storeCtorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseDir: '/custom/knowledge',
    }));
  });

  it('should default to ~/.studio/knowledge when no env var', async () => {
    const expected = path.join(os.homedir(), '.studio', 'knowledge');
    await knowledgeStats({ json: true });
    expect(storeCtorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseDir: expected,
    }));
  });

  it('should use projectPath when provided', async () => {
    await knowledgeStats({ projectPath: '/my/project', json: true });
    expect(storeCtorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseDir: '/my/project/.harness/knowledge',
    }));
  });
});

describe('knowledgeAudit CLI', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    mockRun.mockReturnValue(MOCK_REPORT);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should output JSON when --json is set', async () => {
    await knowledgeAudit({ json: true });
    expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(MOCK_REPORT, null, 2));
  });

  it('should call audit.run with autoFix=true when --fix is set', async () => {
    await knowledgeAudit({ fix: true });
    expect(mockRun).toHaveBeenCalledWith({ autoFix: true });
  });

  it('should call audit.run with autoFix falsy when --dry-run is set', async () => {
    await knowledgeAudit({ dryRun: true });
    expect(mockRun).toHaveBeenCalledWith({ autoFix: undefined });
  });

  it('should call audit.run with autoFix falsy by default', async () => {
    await knowledgeAudit({});
    expect(mockRun).toHaveBeenCalledWith({ autoFix: undefined });
  });

  it('should display total entries and health score', async () => {
    await knowledgeAudit({});
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('总条目: 100');
    expect(output).toContain('95/100');
  });

  it('should display dimension scores', async () => {
    await knowledgeAudit({});
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('D1 结构完整性');
    expect(output).toContain('D6 飞轮验证');
  });

  it('should display autoFixed count when > 0', async () => {
    mockRun.mockReturnValue({ ...MOCK_REPORT, autoFixed: 5, healthScore: { before: 90, after: 95 } });
    await knowledgeAudit({ fix: true });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    expect(output).toContain('自动修复: 5');
    expect(output).toContain('修复后: 95/100');
  });

  it('should pass custom dir to KnowledgeAudit', async () => {
    const { KnowledgeAudit } = require('../../../knowledge/audit');
    await knowledgeAudit({ dir: '/custom/path' });
    expect(KnowledgeAudit).toHaveBeenCalledWith(expect.objectContaining({
      baseDir: '/custom/path',
    }));
  });
});

describe('knowledgeHealth CLI', () => {
  const storeModule = require('../../../knowledge/store');
  let consoleSpy: jest.SpyInstance;
  let storeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    if (storeSpy) storeSpy.mockRestore();
  });

  it('should output health score and summary in JSON mode', async () => {
    storeSpy = jest.spyOn(storeModule, 'FileKnowledgeStore').mockImplementation(() => ({
      list: jest.fn().mockReturnValue([
        { id: 'GUI-001', maturity: 'verified', sourceReferences: [], referencedBy: ['GUI-002'], created: new Date().toISOString() },
        { id: 'GUI-002', maturity: 'draft', sourceReferences: [], referencedBy: [], created: new Date().toISOString() },
      ]),
      getBaseDir: jest.fn().mockReturnValue('/tmp/knowledge'),
    }));

    await knowledgeHealth({ json: true });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('healthScore');
    expect(parsed.summary).toHaveProperty('total', 2);
  });

  it('should detect low-reference verified entries', async () => {
    storeSpy = jest.spyOn(storeModule, 'FileKnowledgeStore').mockImplementation(() => ({
      list: jest.fn().mockReturnValue([
        { id: 'GUI-001', maturity: 'verified', sourceReferences: [], referencedBy: [], created: new Date().toISOString() },
      ]),
      getBaseDir: jest.fn().mockReturnValue('/tmp/knowledge'),
    }));

    await knowledgeHealth({ json: true });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.summary.lowRefEntries).toBe(1);
  });

  it('should detect stale draft entries', async () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
    storeSpy = jest.spyOn(storeModule, 'FileKnowledgeStore').mockImplementation(() => ({
      list: jest.fn().mockReturnValue([
        { id: 'GUI-001', maturity: 'draft', sourceReferences: [], referencedBy: [], created: oldDate },
      ]),
      getBaseDir: jest.fn().mockReturnValue('/tmp/knowledge'),
    }));

    await knowledgeHealth({ json: true });
    const output = consoleSpy.mock.calls.map((c: any[]) => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.summary.staleEntries).toBe(1);
  });
});
