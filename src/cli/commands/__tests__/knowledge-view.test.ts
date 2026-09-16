/**
 * knowledge 投影收口闸（harness#133，架构评审候选4）
 *
 * knowledge 的 11 个子操作原先各自手写「json 投影 + 人读排版」两遍，同一个数据
 * 两处落地、字段名靠人对齐。本文件钉住收口后的四件事：
 *
 * 1. **源形状闸**：`knowledge.ts` 不再出现 chalk / store 构造 / JSON.stringify，
 *    `--json` 分支只余 audit 索引重建一处策略豁免（逐行冻结）；上色与分派的唯一落点在
 *    `knowledge-view.ts`（store 构造与 JSON.stringify 各恰好一处）。
 * 2. **json 形状冻结**：11/11 子操作的字段清单逐条对撞（新增/删字段须显式改清单）。
 * 3. **两投影一致性**：同一 fixture 下，display model 里声明的 `field` 锚点必须能在
 *    json 面解析到；json 面没有的派生量必须走 `derived` 并在此登记豁免理由（无化石条目）。
 * 4. **人读视图逐行冻结**：改造前的整屏输出逐行留档，防止收口顺带改文案。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock chalk（人读断言看的是文本，不看 ANSI）
jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
}));

import { captureIO, lastJsonOutput, type CapturingIO } from '../../command-contract';
import { FileKnowledgeStore } from '../../../knowledge/store';
import type { KnowledgeEntry } from '../../../knowledge/types';
import {
  knowledgeList, knowledgeSearch, knowledgeImport, knowledgeDecay, knowledgeStats,
  knowledgeSyncRag, knowledgeAudit, knowledgeSnapshot, knowledgeMigrate, knowledgeIndex, knowledgeHealth,
  knowledgeListView, knowledgeSearchView, knowledgeImportView, knowledgeDecayView, knowledgeStatsView,
  knowledgeSyncRagView, knowledgeAuditView, knowledgeSnapshotView, knowledgeMigrateView,
  knowledgeIndexView, knowledgeHealthView,
} from '../knowledge';
import { emitKnowledgeView, toneForMaturity, type DisplayCell, type DisplayModel, type KnowledgeView } from '../knowledge-view';
import type { MaturityLevel } from '../../../knowledge/types';

const SRC_DIR = path.join(__dirname, '..');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();

// ========================================
// fixture：3 条知识 + 消费统计 + 2 个 RAG 文档 + README（导入源）
// ========================================

function makeEntry(id: string, overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id,
    type: 'guideline',
    title: `条目 ${id}`,
    content: `这是 ${id} 的正文，包含 autolink 关键词，长度足够避开短内容规则所以问题数可控。`,
    maturity: 'verified',
    layer: 'project',
    created: daysAgo(40),
    lastReferenced: daysAgo(5),
    contributors: ['human'],
    projects: ['harness'],
    tags: ['demo'],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy: ['agent-a:2026-09-01'],
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
    ...overrides,
  } as KnowledgeEntry;
}

/** 每次调用新建一份临时知识库（部分子命令会写盘，fixture 之间必须互不影响） */
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-kview-'));
  const baseDir = path.join(root, '.harness', 'knowledge');
  const store = new FileKnowledgeStore({ baseDir });
  store.save(makeEntry('K-001', { maturity: 'proven', tags: [] }));
  store.save(makeEntry('K-002', { maturity: 'verified' }));
  store.save(makeEntry('K-003', { maturity: 'draft', lastReferenced: '', referencedBy: [], created: daysAgo(200) }));
  fs.writeFileSync(path.join(baseDir, '.consumption-stats.json'), JSON.stringify({ date: '2026-09-02', dailyEvents: 2, searchHits: 1 }));
  const docsDir = path.join(root, '.harness', 'knowledge-docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'a.md'), '# a\n');
  fs.writeFileSync(path.join(docsDir, 'b.md'), '# b\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# readme\n\n导入用的说明文档，内容足够长以生成一条知识条目记录。\n');
  return root;
}

/** 易变量归一：临时根、ISO 时间戳、快照文件名里的日期 */
function normalize(root: string, text: string): string {
  return text
    .split(root).join('<TMP>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>');
}

/** 11 个子命令的驱动面：builder（拿两投影）+ command（拿真实 stdout） */
type SubName =
  | 'list' | 'search' | 'import' | 'decay' | 'stats' | 'sync-rag'
  | 'audit' | 'snapshot' | 'migrate' | 'index' | 'health';

interface SubDriver {
  name: SubName;
  build(root: string, out: CapturingIO): Promise<KnowledgeView> | KnowledgeView;
  run(root: string, out: CapturingIO, json: boolean): Promise<unknown> | unknown;
}

const SUBS: SubDriver[] = [
  {
    name: 'list',
    build: (r, out) => knowledgeListView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeList({ projectPath: r, json }, out),
  },
  {
    name: 'search',
    build: (r, out) => knowledgeSearchView('autolink', { projectPath: r, limit: 20 }, out),
    run: (r, out, json) => knowledgeSearch('autolink', { projectPath: r, json, limit: 20 }, out),
  },
  {
    name: 'import',
    build: (r, out) => knowledgeImportView({ projectPath: r, sources: 'docs,bogus' }, out),
    run: (r, out, json) => knowledgeImport({ projectPath: r, json, sources: 'docs,bogus' }, out),
  },
  {
    name: 'decay',
    build: (r, out) => knowledgeDecayView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeDecay({ projectPath: r, json }, out),
  },
  {
    name: 'stats',
    build: (r, out) => knowledgeStatsView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeStats({ projectPath: r, json }, out),
  },
  {
    name: 'sync-rag',
    build: r => knowledgeSyncRagView({ projectPath: r }),
    run: (r, out, json) => knowledgeSyncRag({ projectPath: r, json }, out),
  },
  {
    name: 'audit',
    build: (r, out) => knowledgeAuditView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeAudit({ projectPath: r, json }, out),
  },
  {
    name: 'snapshot',
    build: (r, out) => knowledgeSnapshotView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeSnapshot({ projectPath: r, json }, out),
  },
  {
    name: 'migrate',
    build: (r, out) => knowledgeMigrateView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeMigrate({ projectPath: r, json }, out),
  },
  {
    name: 'index',
    build: (r, out) => knowledgeIndexView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeIndex({ projectPath: r, json }, out),
  },
  {
    name: 'health',
    build: (r, out) => knowledgeHealthView({ projectPath: r }, out),
    run: (r, out, json) => knowledgeHealth({ projectPath: r, json }, out),
  },
];

// ========================================
// display model 遍历面
// ========================================

export function collectCells(model: DisplayModel): DisplayCell[] {
  return model.sections.flatMap(s => s.rows.flatMap(r => r.cells));
}

/** 点分路径解析；数组支持 `.length` 与下标 */
function resolvePath(root: unknown, dotted: string): { found: boolean; value?: unknown } {
  const parts = dotted.split('.');
  let cursor: unknown = root;
  for (const part of parts) {
    if (part === 'length' && Array.isArray(cursor)) { cursor = cursor.length; continue; }
    if (cursor === null || typeof cursor !== 'object') return { found: false };
    if (!(part in (cursor as Record<string, unknown>))) return { found: false };
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return { found: true, value: cursor };
}

/** 一致性违例：field 锚点在 json 面解析不到，或派生量未登记 */
function anchorViolations(data: unknown, model: DisplayModel, registeredDerived: string[]): string[] {
  const violations: string[] = [];
  for (const cell of collectCells(model)) {
    if ('field' in cell) {
      if (!resolvePath(data, cell.field).found) violations.push(`field 不在 json 面: ${cell.field}`);
    } else if ('derived' in cell) {
      if (!registeredDerived.includes(cell.derived)) violations.push(`派生量未登记豁免: ${cell.derived}`);
    }
  }
  return violations;
}

/** 被用到的派生量键（用于反向查化石豁免） */
function usedDerived(model: DisplayModel): string[] {
  return collectCells(model)
    .filter((c): c is Extract<DisplayCell, { derived: string }> => 'derived' in c)
    .map(c => c.derived);
}

/**
 * 派生量豁免登记（验收 2 的「显式登记理由」）：人读面呈现、但 json 面按现状冻结未暴露的量。
 * 按**源码**核对而不是按 fixture 跑到的分支——溢出计数这类分支 fixture 够不着，
 * 但源码里再没有该派生量时，豁免同样该跟着删（无化石）。
 */
const DERIVED_EXEMPTIONS: Record<string, string> = {
  activeCount:
    'stats 的人读面历史上就多给出一个「活跃」（非 archived）条目数，json 面只有 total。' +
    '#133 冻结 json 现状不新增字段，故该派生量登记豁免。',
  healthIssuesOverflow:
    'health 人读面的「... 还有 N 条」取全量 issues 数组，而 json 面 issues 截前 50 条——' +
    '锚 issues.length 会指向被截断的另一个数，故按派生量登记。',
};

function keysAt(parsed: unknown, dotted: string): string[] {
  const hit = dotted === '' ? { found: true, value: parsed } : resolvePath(parsed, dotted);
  if (!hit.found || hit.value === null || typeof hit.value !== 'object') {
    throw new Error(`json 路径解析失败: ${dotted || '<root>'}`);
  }
  const target = Array.isArray(hit.value) ? hit.value[0] : hit.value;
  if (target === null || typeof target !== 'object') throw new Error(`json 路径不是对象: ${dotted}`);
  return Object.keys(target).sort();
}

/**
 * KnowledgeEntry 序列化后的 json 键清单（fixture 未设置任何可选键）。
 * 条目类型新增字段 → store 输出多出键 → 本清单对不上即红。
 */
const ENTRY_KEYS = [
  'id', 'type', 'title', 'content', 'maturity', 'layer', 'created', 'lastReferenced',
  'contributors', 'projects', 'tags', 'applicablePhases', 'sourceReferences', 'referencedBy',
  'executionResults', 'consumptionMode', 'origin',
];

/**
 * json 字段清单冻结（验收 1）：11/11 子操作，逐条点名。
 * 路径 '' = 顶层；'entries.0' = 数组首元素的键。比较按排序后的集合。
 */
const JSON_FIELD_FREEZE: Record<SubName, Array<{ path: string; keys: string[] }>> = {
  list: [
    { path: '', keys: ['total', 'entries'] },
    { path: 'entries.0', keys: [...ENTRY_KEYS] },
  ],
  search: [
    { path: '', keys: ['query', 'total', 'entries'] },
    { path: 'entries.0', keys: [...ENTRY_KEYS] },
  ],
  import: [
    { path: '', keys: ['totalImported', 'totalErrors', 'results'] },
    { path: 'results.0', keys: ['source', 'entries', 'errors'] },
  ],
  decay: [
    { path: '', keys: ['changes'] },
    { path: 'changes.0', keys: ['entryId', 'from', 'to', 'reason'] },
  ],
  stats: [
    { path: '', keys: ['total', 'byType', 'byMaturity', 'byLayer', 'flywheel'] },
    { path: 'flywheel', keys: ['refCoverage', 'avgRefs', 'consumptionHitRate'] },
  ],
  'sync-rag': [
    { path: '', keys: ['directory', 'files'] },
  ],
  audit: [
    { path: '', keys: ['timestamp', 'totalEntries', 'issues', 'summary', 'dimensions', 'autoFixed', 'healthScore'] },
    { path: 'issues.0', keys: ['rule', 'entryId', 'title', 'severity', 'action', 'detail'] },
    { path: 'summary', keys: [
      'frontmatter-missing', 'test-data-pollution', 'daily-audit-noise', 'event-noise', 'zero-content-proven',
      'maturity-inflation', 'short-content', 'title-duplicate', 'source-refs-bloat', 'fragment-cluster',
      'promotion-blocked', 'orphan-draft', 'stale-entry', 'deprecated-domain',
    ] },
    { path: 'dimensions', keys: ['structure', 'content', 'dedup', 'maturity', 'freshness', 'flywheel', 'incremental'] },
    { path: 'healthScore', keys: ['before', 'after'] },
  ],
  snapshot: [
    { path: '', keys: ['snapshotPath'] },
  ],
  migrate: [
    { path: '', keys: ['total', 'migrated', 'skipped', 'errors'] },
  ],
  index: [
    { path: '', keys: ['path', 'entries', 'size', 'previousSize'] },
  ],
  health: [
    { path: '', keys: ['healthScore', 'summary', 'issues'] },
    { path: 'summary', keys: ['total', 'lowRefEntries', 'staleEntries', 'consumptionData', 'refCoverage', 'avgRefs'] },
    { path: 'issues.0', keys: ['severity', 'entry', 'detail'] },
  ],
};

/**
 * 人读视图逐行冻结（改造前基线，2026-09-15 实测捕获）。
 * 收口只搬排版、不改文案：任一行漂移即红。
 */
const HUMAN_BASELINE: Record<SubName, string[]> = {
  list: [
    '📚 知识库 (3 条)',
    '',
    '  [proven] 条目 K-001',
    '    id: K-001 | type: guideline | layer: project',
    '  [verified] 条目 K-002',
    '    id: K-002 | type: guideline | layer: project',
    '    tags: demo',
    '  [draft] 条目 K-003',
    '    id: K-003 | type: guideline | layer: project',
    '    tags: demo',
  ],
  search: [
    '🔍 搜索 "autolink" (3 条结果)',
    '',
    '  条目 K-001 [proven]',
    '    这是 K-001 的正文，包含 autolink 关键词，长度足够避开短内容规则所以问题数可控。',
    '  条目 K-002 [verified]',
    '    这是 K-002 的正文，包含 autolink 关键词，长度足够避开短内容规则所以问题数可控。',
    '  条目 K-003 [draft]',
    '    这是 K-003 的正文，包含 autolink 关键词，长度足够避开短内容规则所以问题数可控。',
  ],
  import: [
    '📥 开始导入知识 (源: docs, bogus)...',
    '  ✅ docs: 1 条',
    '  ❌ bogus: 未知源类型: bogus',
    '',
    '✅ 导入完成: 1 条，1 个错误',
  ],
  decay: [
    '🔄 运行衰减周期...',
    '📉 1 条知识发生衰减:',
    '',
    '  K-003: draft → archived',
    '    Auto-decay: draft → archived (unreferenced for threshold)',
  ],
  stats: [
    '📊 知识库统计',
    '',
    '  总计: 3 条 (活跃: 3)',
    '',
    '  按类型:',
    '    guideline: 3',
    '',
    '  按成熟度:',
    '    proven: 1',
    '    verified: 1',
    '    draft: 1',
    '',
    '  按层级:',
    '    project: 3',
    '',
    '  飞轮指标:',
    '    引用覆盖: 67%',
    '    平均引用: 0.7',
    '    消费命中率: 67%',
  ],
  'sync-rag': [
    '📄 RAG sync candidates: 2 files in <TMP>/.harness/knowledge-docs',
    '',
    '  a.md',
    '  b.md',
    '',
    'Run `mcp__local-rag__ingest_file` for each to sync to RAG',
  ],
  audit: [
    '🔍 知识库质量审计...',
    '',
    '  总条目: 3',
    '  健康分: 67/100',
    '',
    '  维度评分:',
    '    D1 结构完整性: 100/100 (0 问题)',
    '    D2 内容质量: 0/100 (3 问题)',
    '    D3 去重有效性: 100/100 (0 问题)',
    '    D4 成熟度健康: 0/100 (1 问题)',
    '    D5 新鲜度: 67/100 (1 问题)',
    '    D6 飞轮验证: 56/100 (0 问题)',
    '    D7 增量存活: 100/100 (0 问题)',
    '',
    '  短内容: 3',
    '  promotion 受阻: 1',
    '  过期条目: 1',
    '',
    '  问题详情 (前 20 条):',
    '',
    '  [medium] K-001: 条目 K-001',
    '    内容 48 字符 (阈值 50) → flag',
    '  [medium] K-002: 条目 K-002',
    '    内容 48 字符 (阈值 50) → flag',
    '  [medium] K-003: 条目 K-003',
    '    内容 48 字符 (阈值 50) → flag',
    '  [medium] K-003: 条目 K-003',
    '    draft 已 200 天未被引用 → flag',
    '  [medium] K-003: 条目 K-003',
    '    超过 200 天未引用 (阈值 90) → flag',
    '',
    '  使用 --fix 自动修复',
    '  📇 索引已重建',
  ],
  snapshot: [
    '✅ 快照已保存: <TMP>/.harness/knowledge/.snapshots/index-<DATE>.json',
  ],
  migrate: [
    '🔄 迁移知识条目（添加 consumptionMode/origin 字段）',
    '',
    '  总计: 3 条',
    '  已迁移: 0 条',
    '  已跳过: 3 条',
    '',
    '✅ 所有条目已是最新，无需迁移',
  ],
  index: [
    '📇 索引已重建',
    '  路径: <TMP>/.harness/knowledge/_index.md',
    '  条目: 4',
    '  大小: 0.5 KB',
  ],
  health: [
    '🏥 飞轮健康检查',
    '',
    '  健康分: 99/100',
    '  活跃条目: 3',
    '',
    '  数据流状态:',
    '    引用密度: ✓',
    '    新鲜度: ⚠ 1 个过期 draft',
    '    消费追踪: ✓',
    '',
    '  飞轮指标:',
    '    引用覆盖: 67%',
    '    平均引用: 0.7',
    '',
    '  问题 (前 20):',
    '    [warn] K-003: draft 超过 90 天未推进',
  ],
};

// ========================================
// 用例
// ========================================

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

describe('闸 1：源形状——投影分派与上色只有一处', () => {
  const knowledgeSource = fs.readFileSync(path.join(SRC_DIR, 'knowledge.ts'), 'utf-8').split('\n');
  const viewSource = fs.readFileSync(path.join(SRC_DIR, 'knowledge-view.ts'), 'utf-8').split('\n');
  const code = (lines: string[]): string[] =>
    lines.map(l => l.trim()).filter(l => !l.startsWith('*') && !l.startsWith('//') && !l.startsWith('/*'));

  it('knowledge.ts 不含 chalk / store 构造 / JSON.stringify', () => {
    const lines = code(knowledgeSource);
    expect(lines.filter(l => l.includes("from 'chalk'"))).toEqual([]);
    expect(lines.filter(l => l.includes('chalk.'))).toEqual([]);
    expect(lines.filter(l => /new (File)?KnowledgeStore\(/.test(l))).toEqual([]);
    expect(lines.filter(l => l.includes('JSON.stringify'))).toEqual([]);
  });

  it('knowledge.ts 的退出码返回值只余冻结的豁免行（投影出口由 emit 单点给）', () => {
    expect(code(knowledgeSource).filter(l => l.includes('kind:'))).toEqual([
      "return { kind: 'usage-error', reason: 'knowledge search 缺少关键词位置参数' };",
      // #154：search --limit 脏输入在装配点 fail-loud（原先 parseInt 出 NaN 被 `|| 20`
      // 静默兜成缺省量）。豁免理由同上——入参闸门而非投影出口。
      "return { kind: 'usage-error', reason: `knowledge search --limit 非法限制: \"${limit.raw}\"` };",
      // #152：--threshold 脏输入在装配点 fail-loud（原先 parseInt 出 NaN 静默关掉短内容判定）。
      // 豁免理由同 search 那条——入参闸门而非投影出口，取值/排版仍只在 emit 一处。
      "return { kind: 'usage-error', reason: `knowledge audit --threshold 非法阈值: \"${threshold.raw}\"` };",
    ]);
  });

  it('knowledge.ts 的 json 分支判断只余冻结的豁免行（逐行点名，行变形即红）', () => {
    expect(code(knowledgeSource).filter(l => /^(else )?if\s*\(\s*!?options\.json\b/.test(l))).toEqual([
      'if (!options.json) {', // audit 的索引重建策略，理由见本目录 CONTEXT.md「knowledge view 收口模型」
    ]);
  });

  it('knowledge-view.ts 是 store 构造与 json 投影的唯一落点', () => {
    const lines = code(viewSource);
    expect(lines.filter(l => /new FileKnowledgeStore\(/.test(l))).toHaveLength(1);
    expect(lines.filter(l => l.includes('JSON.stringify'))).toHaveLength(1);
    expect(lines.filter(l => l.includes('import chalk'))).toHaveLength(1);
  });

  it('view 模块的 chalk 调用只准出现在角色→样式的单张表里', () => {
    const sites = code(viewSource).filter(l => l.includes('chalk.'));
    for (const line of sites) {
      expect(line).toMatch(/^\w+: chalk\.\w+,$/);
    }
    expect(sites.length).toBeGreaterThan(0);
  });
});

describe('闸 2：11/11 子操作 --json 字段清单冻结', () => {
  for (const sub of SUBS) {
    it(`${sub.name} 的 json 字段清单 = 冻结清单`, async () => {
      const root = fixture();
      try {
        await sub.run(root, io, true);
        const parsed = JSON.parse(io.outText());
        for (const entry of JSON_FIELD_FREEZE[sub.name]) {
          expect({ path: entry.path, keys: keysAt(parsed, entry.path) })
            .toEqual({ path: entry.path, keys: [...entry.keys].sort() });
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it('冻结清单本身覆盖 11 个子命令（漏登记即红）', () => {
    expect(Object.keys(JSON_FIELD_FREEZE).sort()).toEqual(SUBS.map(s => s.name).sort());
  });
});

describe('闸 3：两投影一致性（同一 fixture）', () => {
  for (const sub of SUBS) {
    it(`${sub.name}：display model 声明的字段锚点全部在 json 面，派生量全部登记`, async () => {
      const root = fixture();
      try {
        const view = await sub.build(root, io);
        const model = view.human();
        expect(anchorViolations(view.data, model, Object.keys(DERIVED_EXEMPTIONS))).toEqual([]);
        for (const derived of usedDerived(model)) {
          expect(DERIVED_EXEMPTIONS[derived]).toBeTruthy();
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it(`${sub.name}：字段锚点在真实 --json 输出里同样解析得到`, async () => {
      const root = fixture();
      try {
        // builder 会就地播报进度行，用独立 io 与之隔离
        const view = await sub.build(root, captureIO());
        const anchored = collectCells(view.human())
          .filter((c): c is Extract<DisplayCell, { field: string }> => 'field' in c)
          .map(c => c.field);
        expect(anchored.length).toBeGreaterThan(0);
        const fresh = fixture();
        try {
          await sub.run(fresh, io, true);
          const parsed = JSON.parse(io.outText());
          for (const field of anchored) {
            expect({ field, found: resolvePath(parsed, field).found }).toEqual({ field, found: true });
          }
        } finally {
          fs.rmSync(fresh, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it('emit 的 json 面就是 data 的序列化：不加壳、不重排、不删键', () => {
    const data = { b: 1, a: 'x', nested: { list: [1, 2] } };
    const jsonIo = captureIO();
    const result = emitKnowledgeView(jsonIo, { json: true }, { data, human: () => ({ sections: [] }) });
    expect(jsonIo.outText()).toBe(JSON.stringify(data, null, 2) + '\n');
    expect(result).toEqual({ kind: 'ok' });
  });

  it('派生量豁免无化石：双向对撞源码里的 derived 声明与登记表', () => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'knowledge.ts'), 'utf-8');
    const declared = [...source.matchAll(/derived: '([a-zA-Z]+)'/g)].map(m => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    expect([...new Set(declared)].sort()).toEqual(Object.keys(DERIVED_EXEMPTIONS).sort());
  });

  it('反证探针：编造的字段锚点与未登记派生量都能被本闸抓到', () => {
    const data = { real: { nested: 1 }, list: [1, 2] };
    const fake: DisplayModel = {
      sections: [{
        rows: [
          { cells: [{ field: 'real.nested', text: '1' }, { field: 'nope.missing', text: 'x' }] },
          { cells: [{ field: 'list.length', text: '2' }, { derived: 'notRegistered', text: 'y' }] },
          { cells: [{ label: '纯文案无需锚点' }] },
        ],
      }],
    };
    expect(anchorViolations(data, fake, ['activeCount'])).toEqual([
      'field 不在 json 面: nope.missing',
      '派生量未登记豁免: notRegistered',
    ]);
    expect(resolvePath(data, 'real.nested').found).toBe(true);
    expect(resolvePath(data, 'nope.missing').found).toBe(false);
  });
});

describe('stats 成熟度格的 tone 传递（harness#158，复审 M7 假闸补钉）', () => {
  // knowledge-tone-mapping.test.ts 钉住了 toneForMaturity 表与渲染链，但没钉「命令侧真的把
  // tone 传进格」——把 knowledge.ts 成熟度格的 `tone:` 摘掉，全仓零红。此处看结构不看 ANSI，
  // 不违背本文件 identity-mock 的立场。
  it('按成熟度段每行首格必须携带 tone 且 = toneForMaturity(maturity)', async () => {
    const root = fixture();
    try {
      const view = await knowledgeStatsView({ projectPath: root }, captureIO());
      const section = view.human().sections.find(s => s.title === '  按成熟度:');
      expect(section).toBeDefined();
      const rows = section!.rows.filter(r => r.cells.some(c => 'field' in c));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cell = row.cells[0];
        expect('field' in cell).toBe(true);
        const field = (cell as { field: string }).field;
        expect(field.startsWith('byMaturity.')).toBe(true);
        const maturity = field.slice('byMaturity.'.length) as MaturityLevel;
        expect({ maturity, tone: (cell as { tone?: string }).tone })
          .toEqual({ maturity, tone: toneForMaturity(maturity) });
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('闸 4：人读视图逐行冻结（改造前基线）', () => {
  for (const sub of SUBS) {
    it(`${sub.name} 的人读输出逐行不变`, async () => {
      const root = fixture();
      const humanIo = captureIO();
      try {
        await sub.run(root, humanIo, false);
        expect(humanIo.outLines().map(l => normalize(root, l))).toEqual(HUMAN_BASELINE[sub.name]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

/**
 * 空知识库态（验收 1 的「每个子操作都有形状断言」的另一半：零条目分支正是两投影
 * 历史上最容易分叉的地方）。以下逐行基线同样取自改造前的实现。
 */
const EMPTY_HUMAN_BASELINE: Record<SubName, string[]> = {
  list: ['知识库为空'],
  search: ['未找到匹配 "autolink" 的知识条目'],
  import: ['📥 开始导入知识 (源: docs, bogus)...', '  ❌ bogus: 未知源类型: bogus', '', '✅ 导入完成: 0 条，1 个错误'],
  decay: ['🔄 运行衰减周期...', '✅ 没有需要衰减的知识条目'],
  stats: [
    '📊 知识库统计',
    '',
    '  总计: 0 条 (活跃: 0)',
    '',
    '  按类型:',
    '',
    '  按成熟度:',
    '',
    '  按层级:',
    '',
    '  飞轮指标:',
    '    引用覆盖: 0%',
    '    平均引用: 0',
    '    消费命中率: 0%',
  ],
  'sync-rag': ['No .harness/knowledge-docs/ directory'],
  audit: [
    '🔍 知识库质量审计...',
    '',
    '  总条目: 0',
    '  健康分: 100/100',
    '',
    '  维度评分:',
    '    D1 结构完整性: 100/100 (0 问题)',
    '    D2 内容质量: 100/100 (0 问题)',
    '    D3 去重有效性: 100/100 (0 问题)',
    '    D4 成熟度健康: 100/100 (0 问题)',
    '    D5 新鲜度: 100/100 (0 问题)',
    '    D6 飞轮验证: 0/100 (0 问题)',
    '    D7 增量存活: 100/100 (0 问题)',
    '',
    '  📇 索引已重建',
  ],
  snapshot: ['✅ 快照已保存: <TMP>/.harness/knowledge/.snapshots/index-<DATE>.json'],
  migrate: [
    '🔄 迁移知识条目（添加 consumptionMode/origin 字段）',
    '',
    '  总计: 0 条',
    '  已迁移: 0 条',
    '  已跳过: 0 条',
    '',
    '✅ 所有条目已是最新，无需迁移',
  ],
  index: [
    '📇 索引已重建',
    '  路径: <TMP>/.harness/knowledge/_index.md',
    '  条目: 2',
    '  大小: 0.3 KB',
  ],
  health: [
    '🏥 飞轮健康检查',
    '',
    '  健康分: 100/100',
    '  活跃条目: 0',
    '',
    '  数据流状态:',
    '    引用密度: ✓',
    '    新鲜度: ✓',
    '    消费追踪: ○ 未启用',
    '',
    '  飞轮指标:',
    '    引用覆盖: 0%',
    '    平均引用: 0',
    '',
    '  问题 (前 20):',
    '    [info] -: 消费追踪数据不存在（<TMP>/.harness/knowledge/.consumption-stats.json）',
  ],
};

function emptyRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-kview-empty-'));
}

describe('闸 4b：空知识库态逐行冻结', () => {
  for (const sub of SUBS) {
    it(`${sub.name} 零条目时的人读输出逐行不变`, async () => {
      const root = emptyRoot();
      const humanIo = captureIO();
      try {
        await sub.run(root, humanIo, false);
        expect(humanIo.outLines().map(l => normalize(root, l))).toEqual(EMPTY_HUMAN_BASELINE[sub.name]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it('零条目态的 --json 仍是同一份 data 的形状（空数组不塌成缺键）', async () => {
    const root = emptyRoot();
    try {
      await knowledgeList({ projectPath: root, json: true }, io);
      expect(lastJsonOutput(io)).toEqual({ total: 0, entries: [] });
      const emptyIo = captureIO();
      await knowledgeDecay({ projectPath: root, json: true }, emptyIo);
      expect(lastJsonOutput(emptyIo)).toEqual({ changes: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * 本票唯一的行为偏离（#133 收尾须知）：sync-rag 的两个空态原先把人类文案
   * 直接打到 stdout——`--json` 下吐出的不是 JSON。收口到单点分派后，空态由
   * display model 承担，json 面恒为 `{directory, files}`。零程序化消费者（决策
   * 记录见本目录 CONTEXT.md），故按缺陷修正处理。
   */
  it('sync-rag 空态在 --json 下产出 JSON 而非人类文案（对改造前行为的有意修正）', async () => {
    const root = emptyRoot();
    try {
      await knowledgeSyncRag({ projectPath: root, json: true }, io);
      expect(lastJsonOutput(io)).toEqual({ directory: `${root}/.harness/knowledge-docs`, files: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * 同一子命令的第二空态（harness#151 补 #133 闸 4b 的判据）。
 *
 * `emptyRoot()` 是裸的 mkdtemp 目录，天然没有 `.harness/knowledge-docs/` 子目录，于是
 * `syncRagRows`（`knowledge.ts:394`）的两个空态分支里只有第一个 `!docsPresent` 进过基线；
 * 第二个分支（目录在场、里面没有 `.md`）在测试里**走不到**——按 #133 自己立的判据，
 * 「fixture 走不到的分支不进基线，有基线就是假象」。json 面两分支恒同形
 * （`data = {directory, files}`），所以 `--json` 那条断言也钉不住人读第二行。
 *
 * 数据结构：既有 `EMPTY_HUMAN_BASELINE: Record<SubName, string[]>` 一个子命令只装得下
 * 一种形状，故另立一张平行表按 case 登记，不动既有用例。每个 case 自带建形函数——
 * 多空态不共用一个根。
 */
interface EmptyShapeCase {
  sub: SubName;
  /** 分支说明，进用例标题 */
  branch: string;
  /** 该分支的建形方式（与 emptyRoot() 的区别就是要建的那个形） */
  makeRoot(): string;
  baseline: string[];
  /** 该形状下 --json 的形状（两投影一致性在此分支的第二形） */
  json: (root: string) => unknown;
}

/** `knowledge-docs/` 在场但目录里没有 `.md` → syncRagRows 第二分支 */
function emptyDocsRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-kview-emptydocs-'));
  fs.mkdirSync(path.join(root, '.harness', 'knowledge-docs'), { recursive: true });
  return root;
}

const EXTRA_EMPTY_HUMAN_CASES: EmptyShapeCase[] = [
  {
    sub: 'sync-rag',
    branch: 'knowledge-docs/ 在场但目录里没有 .md',
    makeRoot: emptyDocsRoot,
    baseline: ['No knowledge docs found'],
    json: root => ({ directory: `${root}/.harness/knowledge-docs`, files: [] }),
  },
];

describe('闸 4c：同一子命令的第二空态逐行冻结（#151 补 #133 判据）', () => {
  for (const testCase of EXTRA_EMPTY_HUMAN_CASES) {
    const driver = SUBS.find(s => s.name === testCase.sub);
    if (!driver) throw new Error(`case 登记的子命令不在驱动面里: ${testCase.sub}`);

    it(`${testCase.sub} 的「${testCase.branch}」人读输出逐行不变`, async () => {
      const root = testCase.makeRoot();
      const humanIo = captureIO();
      try {
        await driver.run(root, humanIo, false);
        expect(humanIo.outLines().map(l => normalize(root, l))).toEqual(testCase.baseline);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it(`${testCase.sub} 的「${testCase.branch}」在 --json 下仍是两分支同形的那份 data`, async () => {
      const root = testCase.makeRoot();
      try {
        await driver.run(root, io, true);
        expect(lastJsonOutput(io)).toEqual(testCase.json(root));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it('第二形登记的子命令确有独立基线（不借 闸 4b 的第一形蒙过去）', () => {
    for (const testCase of EXTRA_EMPTY_HUMAN_CASES) {
      expect(EMPTY_HUMAN_BASELINE[testCase.sub]).not.toEqual(testCase.baseline);
    }
  });
});
