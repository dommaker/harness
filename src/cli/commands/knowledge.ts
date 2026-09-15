/**
 * harness knowledge 命令
 *
 * 知识库管理 11 子操作（list/search/import/decay/stats/sync-rag/audit/snapshot/migrate/index/health）。
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeQuery } from '../../knowledge/query';
import { KnowledgeLifecycle } from '../../knowledge/lifecycle';
import { ColdStartImporter } from '../../knowledge/import';
import { KnowledgeAudit } from '../../knowledge/audit';
import type { AuditReport, AuditRuleName, DimensionMetrics } from '../../knowledge/audit';
import { evaluateFlywheel } from '../../knowledge/flywheel-metrics';
import { migrateKnowledgeEntries } from '../../knowledge/migration';
import { KnowledgeIndexGenerator } from '../../knowledge/index-generator';
import type { KnowledgeEntry, KnowledgeSubsystem, MaturityChange, MaturityLevel, QueryFilter } from '../../knowledge/types';
import { logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import {
  announce,
  blankLine,
  dimensionLabel,
  emitKnowledgeView,
  openKnowledgeStore,
  resolveKnowledgeBaseDir,
  ruleLabel,
  toneForMaturity,
  toneForScore,
  toneForSeverity,
  type DisplayModel,
  type DisplayRow,
  type DisplaySection,
  type KnowledgeView,
} from './knowledge-view';

export interface KnowledgeOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 输出 JSON 格式 */
  json?: boolean;
}

/** 子操作共用的入参面：知识库目录覆盖（audit/snapshot/migrate/index/health 收） */
type KnowledgeDirOption = { dir?: string };

// ========================================
// list
// ========================================

function listFilter(options: KnowledgeListOptions): QueryFilter {
  const filter: QueryFilter = { excludeArchived: false };
  if (options.type) filter.types = options.type.split(',') as KnowledgeSubsystem[];
  if (options.maturity) filter.maturity = options.maturity.split(',') as MaturityLevel[];
  if (options.tag) filter.tags = options.tag.split(',');
  return filter;
}

export interface KnowledgeListOptions extends KnowledgeOptions {
  type?: string;
  maturity?: string;
  tag?: string;
}

export function knowledgeListView(options: KnowledgeListOptions, io: CommandIO) {
  const entries = openKnowledgeStore(options, io).list(listFilter(options));
  const data = { total: entries.length, entries };

  return { data, human: (): DisplayModel => ({ sections: [{ rows: listRows(entries) }] }) };
}

function listRows(entries: KnowledgeEntry[]): DisplayRow[] {
  if (entries.length === 0) {
    return [{ cells: [{ label: '知识库为空', tone: 'warn' }] }];
  }
  const rows: DisplayRow[] = [
    { cells: [
      { label: '📚 知识库 (', tone: 'heading' },
      { field: 'total', text: String(entries.length), tone: 'heading' },
      { label: ' 条)', tone: 'heading' },
    ] },
    blankLine(),
  ];
  entries.forEach((entry, i) => {
    rows.push({ cells: [
      { field: `entries.${i}.maturity`, text: `  [${entry.maturity}]`, tone: toneForMaturity(entry.maturity) },
      { field: `entries.${i}.title`, text: ` ${entry.title}`, tone: 'emph' },
    ] });
    rows.push({ cells: [
      { field: `entries.${i}.id`, text: `    id: ${entry.id}`, tone: 'muted' },
      { field: `entries.${i}.type`, text: ` | type: ${entry.type}`, tone: 'muted' },
      { field: `entries.${i}.layer`, text: ` | layer: ${entry.layer}`, tone: 'muted' },
    ] });
    if (entry.tags.length > 0) {
      rows.push({ cells: [{ field: `entries.${i}.tags`, text: `    tags: ${entry.tags.join(', ')}`, tone: 'muted' }] });
    }
  });
  return rows;
}

export async function knowledgeList(options: KnowledgeListOptions, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeListView(options, io));
}

// ========================================
// search
// ========================================

export function knowledgeSearchView(
  query: string,
  options: KnowledgeOptions & { limit?: number },
  io: CommandIO,
) {
  const store = openKnowledgeStore(options, io);
  const matched = new KnowledgeQuery(store).search(query, { limit: options.limit || 20 });
  const data = { query, total: matched.length, entries: matched };

  return { data, human: (): DisplayModel => ({ sections: [{ rows: searchRows(query, matched) }] }) };
}

function searchRows(query: string, matched: KnowledgeEntry[]): DisplayRow[] {
  if (matched.length === 0) {
    return [{ cells: [{ label: `未找到匹配 "${query}" 的知识条目`, tone: 'warn' }] }];
  }
  const rows: DisplayRow[] = [
    { cells: [
      { label: '🔍 搜索 "', tone: 'heading' },
      { field: 'query', text: query, tone: 'heading' },
      { label: '" (', tone: 'heading' },
      { field: 'total', text: String(matched.length), tone: 'heading' },
      { label: ' 条结果)', tone: 'heading' },
    ] },
    blankLine(),
  ];
  matched.forEach((entry, i) => {
    const preview = entry.content.slice(0, 100).replace(/\n/g, ' ') + (entry.content.length > 100 ? '...' : '');
    rows.push({ cells: [
      { field: `entries.${i}.title`, text: `  ${entry.title}`, tone: 'emph' },
      { field: `entries.${i}.maturity`, text: ` [${entry.maturity}]`, tone: 'muted' },
    ] });
    rows.push({ cells: [{ field: `entries.${i}.content`, text: `    ${preview}`, tone: 'muted' }] });
  });
  return rows;
}

export async function knowledgeSearch(
  query: string,
  options: KnowledgeOptions & { limit?: number },
  io: CommandIO = processIO,
): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeSearchView(query, options, io));
}

/**
 * knowledge search 子命令入口（候选7）：缺参闸门 + limit 强转编组，
 * 自 definitions.ts 的 args 复印块移回命令模块（interface/测试面所在）。
 */
export async function knowledgeSearchCommand(
  positionals: (string | undefined)[],
  options: Record<string, unknown>,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const query = positionals[0];
  if (!query) {
    logError(io, '请提供搜索关键词');
    return { kind: 'usage-error', reason: 'knowledge search 缺少关键词位置参数' };
  }
  return knowledgeSearch(String(query), {
    projectPath: options.projectPath as string | undefined,
    json: options.json as boolean | undefined,
    limit: parseInt(String(options.limit), 10),
  });
}

// ========================================
// import（冷启动）
// ========================================

export async function knowledgeImportView(
  options: KnowledgeOptions & { sources?: string; reset?: boolean },
  io: CommandIO,
) {
  const projectPath = options.projectPath || process.cwd();
  const store = openKnowledgeStore(options, io);
  const sources = options.sources
    ? options.sources.split(',') as Array<'code' | 'git' | 'docs' | 'manual'>
    : ['code', 'git', 'docs'] as Array<'code' | 'git' | 'docs'>;

  const importer = new ColdStartImporter({ projectRoot: projectPath, store, sources });

  if (options.reset) {
    importer.resetState();
    announce(io, options.json, '🔄 已重置导入状态', 'warn');
  }
  announce(io, options.json, `📥 开始导入知识 (源: ${sources.join(', ')})...`);

  const results = await importer.importAll();
  const data = {
    totalImported: results.reduce((sum, r) => sum + r.entries.length, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    results,
  };

  return { data, human: (): DisplayModel => ({ sections: [{ rows: importRows(data) }] }) };
}

type ImportOutcome = Awaited<ReturnType<ColdStartImporter['importAll']>>;

function importRows(data: { totalImported: number; totalErrors: number; results: ImportOutcome }): DisplayRow[] {
  const rows: DisplayRow[] = [];
  data.results.forEach((result, i) => {
    if (result.entries.length > 0) {
      rows.push({ cells: [
        { field: `results.${i}.source.type`, text: `  ✅ ${result.source.type}: `, tone: 'ok' },
        { field: `results.${i}.entries.length`, text: `${result.entries.length} 条`, tone: 'ok' },
      ] });
    }
    result.errors.forEach((err, j) => {
      rows.push({ cells: [
        { field: `results.${i}.source.type`, text: `  ❌ ${result.source.type}: `, tone: 'error' },
        { field: `results.${i}.errors.${j}.message`, text: err.message, tone: 'error' },
      ] });
    });
  });
  rows.push(blankLine(), { cells: [
    { label: '✅ 导入完成: ', tone: 'ok' },
    { field: 'totalImported', text: String(data.totalImported), tone: 'ok' },
    { label: ' 条，', tone: 'ok' },
    { field: 'totalErrors', text: String(data.totalErrors), tone: 'ok' },
    { label: ' 个错误', tone: 'ok' },
  ] });
  return rows;
}

export async function knowledgeImport(
  options: KnowledgeOptions & { sources?: string; reset?: boolean },
  io: CommandIO = processIO,
): Promise<CommandResult> {
  return emitKnowledgeView(io, options, await knowledgeImportView(options, io));
}

// ========================================
// decay
// ========================================

export function knowledgeDecayView(options: KnowledgeOptions, io: CommandIO) {
  const lifecycle = new KnowledgeLifecycle(openKnowledgeStore(options, io));
  announce(io, options.json, '🔄 运行衰减周期...');
  const changes = lifecycle.runDecayCycle();
  const data = { changes };

  return { data, human: (): DisplayModel => ({ sections: [{ rows: decayRows(changes) }] }) };
}

function decayRows(changes: MaturityChange[]): DisplayRow[] {
  if (changes.length === 0) {
    return [{ cells: [{ label: '✅ 没有需要衰减的知识条目', tone: 'ok' }] }];
  }
  const rows: DisplayRow[] = [
    { cells: [
      { label: '📉 ', tone: 'warn' },
      { field: 'changes.length', text: String(changes.length), tone: 'warn' },
      { label: ' 条知识发生衰减:', tone: 'warn' },
    ] },
    blankLine(),
  ];
  changes.forEach((change, i) => {
    rows.push({ cells: [
      { field: `changes.${i}.entryId`, text: `  ${change.entryId}: ` },
      { field: `changes.${i}.from`, text: change.from, tone: 'error' },
      { label: ' → ' },
      { field: `changes.${i}.to`, text: change.to, tone: 'ok' },
    ] });
    rows.push({ cells: [{ field: `changes.${i}.reason`, text: `    ${change.reason}`, tone: 'muted' }] });
  });
  return rows;
}

export async function knowledgeDecay(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeDecayView(options, io));
}

// ========================================
// stats
// ========================================

export function knowledgeStatsView(options: KnowledgeOptions, io: CommandIO) {
  const store = openKnowledgeStore(options, io);
  const entries = store.list({ excludeArchived: false });
  const active = entries.filter(e => e.maturity !== 'archived');

  const byType: Record<string, number> = {};
  const byMaturity: Record<string, number> = {};
  const byLayer: Record<string, number> = {};
  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byMaturity[entry.maturity] = (byMaturity[entry.maturity] || 0) + 1;
    byLayer[entry.layer] = (byLayer[entry.layer] || 0) + 1;
  }

  // 飞轮指标：计算唯一实现在 knowledge/flywheel-metrics，此处只做 fs 读取 + 展示层单位映射
  let dailyConsumptionEvents = 0;
  try {
    const statsPath = path.join(store.getBaseDir(), '.consumption-stats.json');
    if (fs.existsSync(statsPath)) {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
      dailyConsumptionEvents = stats.dailyEvents || 0;
    }
  } catch { /* best-effort */ }

  const metrics = evaluateFlywheel({ entries: active, dailyConsumptionEvents });
  const flywheel = {
    refCoverage: Math.round(metrics.refCoverage * 100),
    avgRefs: Math.round(metrics.avgRefs * 10) / 10,
    consumptionHitRate: Math.round(metrics.consumptionHitRate * 100),
  };

  const data = { total: entries.length, byType, byMaturity, byLayer, flywheel };
  const activeCount = active.length;

  return {
    data,
    human: (): DisplayModel => ({
      sections: [
        {
          rows: [
            { cells: [{ label: '📊 知识库统计', tone: 'heading' }] },
            blankLine(),
            {
              cells: [
                { label: '  总计: ', tone: 'emph' },
                { field: 'total', text: String(data.total), tone: 'emph' },
                { label: ' 条 (活跃: ', tone: 'emph' },
                { derived: 'activeCount', text: String(activeCount), tone: 'emph' },
                { label: ')', tone: 'emph' },
              ],
            },
            blankLine(),
          ],
        },
        { title: '  按类型:', rows: [...countRows('byType', byType), blankLine()] },
        {
          title: '  按成熟度:',
          rows: [...Object.entries(byMaturity).map(([maturity, count]) => ({
            cells: [
              { field: `byMaturity.${maturity}`, text: `    ${maturity}`, tone: toneForMaturity(maturity as MaturityLevel) },
              { field: `byMaturity.${maturity}`, text: `: ${count}` },
            ],
          })), blankLine()],
        },
        { title: '  按层级:', rows: [...countRows('byLayer', byLayer), blankLine()] },
        {
          title: '  飞轮指标:',
          rows: [
            { cells: [{ label: '    引用覆盖: ' }, { field: 'flywheel.refCoverage', text: `${flywheel.refCoverage}%` }] },
            { cells: [{ label: '    平均引用: ' }, { field: 'flywheel.avgRefs', text: String(flywheel.avgRefs) }] },
            { cells: [{ label: '    消费命中率: ' }, { field: 'flywheel.consumptionHitRate', text: `${flywheel.consumptionHitRate}%` }] },
          ],
        },
      ],
    }),
  };
}

function countRows(field: string, counts: Record<string, number>): DisplayRow[] {
  return Object.entries(counts).map(([key, count]) => ({
    cells: [
      { label: '    ' },
      { field: `${field}.${key}`, text: `${key}: ${count}` },
    ],
  }));
}

export async function knowledgeStats(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeStatsView(options, io));
}

// ========================================
// sync-rag
// ========================================

export function knowledgeSyncRagView(options: KnowledgeOptions) {
  const projectPath = options.projectPath || process.cwd();
  const docsDir = `${projectPath}/.harness/knowledge-docs`;
  const docsPresent = fs.existsSync(docsDir);
  const files = docsPresent ? fs.readdirSync(docsDir).filter(f => f.endsWith('.md')) : [];
  const data = { directory: docsDir, files };

  return { data, human: (): DisplayModel => ({ sections: [{ rows: syncRagRows(docsPresent, docsDir, files) }] }) };
}

function syncRagRows(docsPresent: boolean, docsDir: string, files: string[]): DisplayRow[] {
  if (!docsPresent) return [{ cells: [{ label: 'No .harness/knowledge-docs/ directory', tone: 'warn' }] }];
  if (files.length === 0) return [{ cells: [{ label: 'No knowledge docs found', tone: 'muted' }] }];
  return [
    { cells: [
      { label: '📄 RAG sync candidates: ', tone: 'heading' },
      { field: 'files.length', text: String(files.length), tone: 'heading' },
      { label: ' files in ', tone: 'heading' },
      { field: 'directory', text: docsDir, tone: 'heading' },
    ] },
    blankLine(),
    ...files.map((file, i) => ({ cells: [{ field: `files.${i}`, text: `  ${file}`, tone: 'accent' as const }] })),
    blankLine(),
    { cells: [{ label: 'Run `mcp__local-rag__ingest_file` for each to sync to RAG', tone: 'muted' }] },
  ];
}

export async function knowledgeSyncRag(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeSyncRagView(options));
}

// ========================================
// audit（知识库质量审计）
// ========================================

export type KnowledgeAuditOptions = KnowledgeOptions & KnowledgeDirOption & {
  fix?: boolean;
  dryRun?: boolean;
  /**
   * `--threshold <n>` 的 commander 原值。旗帜给到的恒是字符串（缺省 '50' 也是），
   * 声明跟着运行时走（harness#152）；窄化在 `knowledgeAudit` 装配点做一次。
   */
  threshold?: string;
};

/** `knowledgeAuditView` 的入参面：threshold 已过装配窄化，引擎槽位要的是数值 */
export type KnowledgeAuditViewOptions = Omit<KnowledgeAuditOptions, 'threshold'> & {
  threshold?: number;
};

/** 阈值装配结果：`ok: false` = 脏输入，由命令入口 fail-loud（不得往判定槽塞 NaN） */
type ThresholdAssembly = { ok: true; value?: number } | { ok: false; raw: string };

/**
 * `--threshold` 的装配点窄化（harness#152）：非负整数字符串 → 数值，转不出来即脏输入。
 * `undefined` = 未传，落引擎缺省（50）；`'0'` 是显式零值，不当「未传」兜掉。
 */
function assembleShortContentThreshold(raw: string | undefined): ThresholdAssembly {
  if (raw === undefined) return { ok: true };
  const digits = raw.trim();
  return /^\d+$/.test(digits)
    ? { ok: true, value: Number(digits) }
    : { ok: false, raw };
}

export function knowledgeAuditView(options: KnowledgeAuditViewOptions, io: CommandIO) {
  const audit = new KnowledgeAudit({
    baseDir: resolveKnowledgeBaseDir(options, io),
    shortContentThreshold: options.threshold,
  });
  const isDryRun = options.dryRun && !options.fix;
  if (!isDryRun) announce(io, options.json, '🔍 知识库质量审计...\n');
  const report = audit.run({ autoFix: options.fix && !isDryRun });
  const showFixHint = !options.fix && report.issues.length > 0;

  return {
    data: report,
    human: (): DisplayModel => ({ sections: auditSections(report, showFixHint) }),
  };
}

function auditSections(report: AuditReport, showFixHint: boolean): DisplaySection[] {
  const sections: DisplaySection[] = [{
    rows: [
      { cells: [{ label: '  总条目: ', tone: 'emph' }, { field: 'totalEntries', text: String(report.totalEntries), tone: 'emph' }] },
      { cells: [{ label: '  健康分: ', tone: 'emph' }, { field: 'healthScore.before', text: `${report.healthScore.before}/100`, tone: 'emph' }] },
    ],
  }];

  if (report.autoFixed > 0) {
    sections[0].rows.push(
      { cells: [{ label: '  自动修复: ', tone: 'ok' }, { field: 'autoFixed', text: String(report.autoFixed), tone: 'ok' }] },
      { cells: [{ label: '  修复后: ', tone: 'emph' }, { field: 'healthScore.after', text: `${report.healthScore.after}/100`, tone: 'emph' }] },
    );
  }
  sections[0].rows.push(blankLine());

  const dimensions: DisplayRow[] = [];
  for (const [key, dim] of Object.entries(report.dimensions) as Array<[keyof AuditReport['dimensions'], DimensionMetrics]>) {
    dimensions.push({ cells: [
      { field: `dimensions.${key}`, text: `    ${dimensionLabel(key)}: ` },
      { field: `dimensions.${key}.score`, text: `${dim.score}/100`, tone: toneForScore(dim.score) },
      { field: `dimensions.${key}.issues`, text: ` (${dim.issues} 问题)` },
    ] });
  }
  dimensions.push(blankLine());
  sections.push({ title: '  维度评分:', rows: dimensions });

  // 规则 label 正本在 audit.ts 的规则定义上（#109 编译期闭环经 ruleLabel 转发）
  const rules: DisplayRow[] = [];
  for (const [rule, count] of Object.entries(report.summary) as Array<[AuditRuleName, number]>) {
    if (count === 0) continue;
    rules.push({ cells: [{ field: `summary.${rule}`, text: `  ${ruleLabel(rule)}: ${count}`, tone: 'error' }] });
  }
  if (report.issues.length > 0) {
    rules.push(blankLine()); // 「问题详情」标题前的空行（原排版是 `\n` 前缀）
  }
  sections.push({ rows: rules });

  if (report.issues.length > 0) {
    const issues: DisplayRow[] = [blankLine()];
    for (const [i, issue] of report.issues.slice(0, 20).entries()) {
      issues.push({ cells: [
        { field: `issues.${i}.severity`, text: `  [${issue.severity}]`, tone: toneForSeverity(issue.severity) },
        { field: `issues.${i}.entryId`, text: ` ${issue.entryId}: ` },
        { field: `issues.${i}.title`, text: issue.title },
      ] });
      issues.push({ cells: [
        { field: `issues.${i}.detail`, text: `    ${issue.detail}`, tone: 'muted' },
        { label: ' → ' },
        { field: `issues.${i}.action`, text: issue.action },
      ] });
    }
    if (report.issues.length > 20) {
      issues.push(blankLine(), { cells: [
        { label: '  ... 还有 ', tone: 'muted' },
        { field: 'issues.length', text: String(report.issues.length - 20), tone: 'muted' },
        { label: ' 条', tone: 'muted' },
      ] });
    }
    sections.push({ title: '  问题详情 (前 20 条):', rows: issues });
  }

  if (showFixHint) {
    sections.push({ rows: [blankLine(), { cells: [{ label: '  使用 --fix 自动修复', tone: 'warn' }] }] });
  }
  return sections;
}

export async function knowledgeAudit(options: KnowledgeAuditOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const threshold = assembleShortContentThreshold(options.threshold);
  if (!threshold.ok) {
    logError(io, `错误：--threshold 需要非负整数阈值（字符数），收到 "${threshold.raw}"；短内容判定未执行`);
    return { kind: 'usage-error', reason: `knowledge audit --threshold 非法阈值: "${threshold.raw}"` };
  }
  const result = emitKnowledgeView(io, options, knowledgeAuditView({ ...options, threshold: threshold.value }, io));
  // 审计可能改文件，人读路径收尾重建索引；--json 保持不写盘（现状冻结，#133 不动这条策略）
  if (!options.json) {
    new KnowledgeIndexGenerator(resolveKnowledgeBaseDir(options, io)).regenerate();
    announce(io, options.json, '  📇 索引已重建', 'muted');
  }
  return result;
}

// ========================================
// snapshot（KR4 存活率追踪）
// ========================================

export function knowledgeSnapshotView(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO) {
  const snapshotPath = openKnowledgeStore(options, io).snapshot();
  const data = { snapshotPath };

  return {
    data,
    human: (): DisplayModel => ({
      sections: [{
        rows: [{
          cells: [
            { label: '✅ 快照已保存: ', tone: 'ok' },
            { field: 'snapshotPath', text: snapshotPath, tone: 'ok' },
          ],
        }],
      }],
    }),
  };
}

export function knowledgeSnapshot(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO = processIO): CommandResult {
  return emitKnowledgeView(io, options, knowledgeSnapshotView(options, io));
}

// ========================================
// migrate（为现有条目补 AS-021 新字段）
// ========================================

/** migrateKnowledgeEntries 的返回面 = migrate 的 json 正本（该类型未从 knowledge/migration 导出，此处同构声明） */
type MigrateResult = { total: number; migrated: number; skipped: number; errors: string[] };

export function knowledgeMigrateView(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO): KnowledgeView<MigrateResult> {
  const result = migrateKnowledgeEntries(resolveKnowledgeBaseDir(options, io));

  return {
    data: result,
    human: (): DisplayModel => ({ sections: [{ rows: migrateRows(result) }] }),
  };
}

function migrateRows(result: MigrateResult): DisplayRow[] {
  const rows: DisplayRow[] = [
    { cells: [{ label: '🔄 迁移知识条目（添加 consumptionMode/origin 字段）', tone: 'heading' }] },
    blankLine(),
    { cells: [{ label: '  总计: ', tone: 'ok' }, { field: 'total', text: String(result.total), tone: 'ok' }, { label: ' 条', tone: 'ok' }] },
    { cells: [{ label: '  已迁移: ', tone: 'ok' }, { field: 'migrated', text: String(result.migrated), tone: 'ok' }, { label: ' 条', tone: 'ok' }] },
    { cells: [{ label: '  已跳过: ', tone: 'muted' }, { field: 'skipped', text: String(result.skipped), tone: 'muted' }, { label: ' 条', tone: 'muted' }] },
  ];
  if (result.errors.length > 0) {
    rows.push(
      blankLine(),
      { cells: [{ label: '  错误: ', tone: 'error' }, { field: 'errors.length', text: String(result.errors.length), tone: 'error' }, { label: ' 条', tone: 'error' }] },
    );
    result.errors.slice(0, 5).forEach((err, i) => {
      rows.push({ cells: [{ label: '    ' }, { field: `errors.${i}`, text: err, tone: 'error' }] });
    });
  }
  // 两种收尾语各自带一个前导空行；migrated=0 且有错误时历史上两句都不打
  if (result.migrated === 0 && result.errors.length === 0) {
    rows.push(blankLine(), { cells: [{ label: '✅ 所有条目已是最新，无需迁移', tone: 'ok' }] });
  } else if (result.migrated > 0) {
    rows.push(blankLine(), { cells: [{ label: '✅ 迁移完成', tone: 'ok' }] });
  }
  return rows;
}

export function knowledgeMigrate(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO = processIO): CommandResult {
  return emitKnowledgeView(io, options, knowledgeMigrateView(options, io));
}

// ========================================
// index（重建 _index.md 供 Agent grep，并同步 index.json）
// ========================================

export function knowledgeIndexView(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO) {
  const baseDir = resolveKnowledgeBaseDir(options, io);
  const indexPath = path.join(baseDir, '_index.md');
  const beforeSize = fs.existsSync(indexPath) ? fs.statSync(indexPath).size : 0;

  const output = new KnowledgeIndexGenerator(baseDir).regenerate();
  // Sync index.json from disk files (removes ghost entries from manual mv/rm)
  openKnowledgeStore({ dir: baseDir }, io).rebuildIndex();

  const afterSize = Buffer.byteLength(output, 'utf-8');
  const lineCount = output.split('\n').filter(l => !l.startsWith('#')).length;
  const data = { path: indexPath, entries: lineCount, size: afterSize, previousSize: beforeSize };

  return {
    data,
    human: (): DisplayModel => ({ sections: [{ rows: indexRows({ indexPath, afterSize, lineCount, beforeSize }) }] }),
  };
}

function indexRows(shape: { indexPath: string; afterSize: number; lineCount: number; beforeSize: number }): DisplayRow[] {
  const rows: DisplayRow[] = [
    { cells: [{ label: '📇 索引已重建', tone: 'heading' }] },
    { cells: [{ label: '  路径: ', tone: 'muted' }, { field: 'path', text: shape.indexPath, tone: 'muted' }] },
    { cells: [{ label: '  条目: ', tone: 'ok' }, { field: 'entries', text: String(shape.lineCount), tone: 'ok' }] },
    { cells: [{ label: '  大小: ', tone: 'ok' }, { field: 'size', text: `${(shape.afterSize / 1024).toFixed(1)} KB`, tone: 'ok' }] },
  ];
  if (shape.beforeSize > 0) {
    rows.push({ cells: [{ label: '  旧大小: ', tone: 'muted' }, { field: 'previousSize', text: `${(shape.beforeSize / 1024).toFixed(1)} KB`, tone: 'muted' }] });
  }
  return rows;
}

export function knowledgeIndex(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO = processIO): CommandResult {
  return emitKnowledgeView(io, options, knowledgeIndexView(options, io));
}

// ========================================
// health（飞轮健康检查 — 零 token 检测数据流状态）
// ========================================

interface HealthIssue {
  severity: 'error' | 'warn' | 'info';
  entry: string;
  detail: string;
}

/** health 的 json 面正本（字段清单冻结在 __tests__/knowledge-view.test.ts） */
interface HealthData {
  healthScore: number;
  summary: {
    total: number;
    lowRefEntries: number;
    staleEntries: number;
    consumptionData: boolean;
    refCoverage: number;
    avgRefs: number;
  };
  issues: HealthIssue[];
}

export function knowledgeHealthView(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO) {
  const store = openKnowledgeStore(options, io);
  const baseDir = store.getBaseDir();
  const entries = store.list({ excludeArchived: true });

  const issues: HealthIssue[] = [];

  // D1: 引用密度检查（低引用 = 可能孤立）
  let lowRefEntries = 0;
  for (const entry of entries) {
    if (entry.referencedBy.length === 0 && entry.maturity === 'verified') {
      lowRefEntries++;
      issues.push({ severity: 'info', entry: entry.id, detail: `verified 条目零引用（可能孤立）` });
    }
  }

  // D2: 新鲜度检查
  const now = Date.now();
  const staleThreshold = 90 * 24 * 60 * 60 * 1000; // 90 days
  let staleEntries = 0;
  for (const entry of entries) {
    const created = new Date(entry.created).getTime();
    if (now - created > staleThreshold && entry.maturity === 'draft') {
      staleEntries++;
      issues.push({ severity: 'warn', entry: entry.id, detail: `draft 超过 90 天未推进` });
    }
  }

  // D3: 消费数据检查
  const statsPath = path.join(baseDir, '.consumption-stats.json');
  const consumptionData = fs.existsSync(statsPath);
  if (!consumptionData) {
    issues.push({ severity: 'info', entry: '-', detail: `消费追踪数据不存在（${statsPath}）` });
  }

  // D4: 飞轮指标（计算唯一实现在 knowledge/flywheel-metrics；人口为本命令的 excludeArchived 切片）
  const metrics = evaluateFlywheel({ entries });
  const refCoverage = Math.round(metrics.refCoverage * 100);
  const avgRefs = Math.round(metrics.avgRefs * 10) / 10;

  const totalIssues = issues.filter(i => i.severity === 'error').length * 3
    + issues.filter(i => i.severity === 'warn').length * 1;
  const healthScore = Math.max(0, 100 - totalIssues);

  const data: HealthData = {
    healthScore,
    summary: { total: entries.length, lowRefEntries, staleEntries, consumptionData, refCoverage, avgRefs },
    issues: issues.slice(0, 50),
  };

  return { data, human: (): DisplayModel => ({ sections: healthSections(data) }) };
}

function healthSections(data: HealthData): DisplaySection[] {
  const { healthScore, summary, issues } = data;
  const scoreTone = toneForScore(healthScore);
  return [
    {
      rows: [
        { cells: [{ label: '🏥 飞轮健康检查', tone: 'heading' }] },
        blankLine(),
        { cells: [
          { label: '  健康分: ', tone: 'emph' },
          { field: 'healthScore', text: String(healthScore), tone: scoreTone },
          { label: '/100', tone: 'emph' },
        ] },
        { cells: [
          { label: '  活跃条目: ', tone: 'emph' },
          { field: 'summary.total', text: String(summary.total), tone: 'emph' },
        ] },
        blankLine(),
      ],
    },
    {
      title: '  数据流状态:',
      rows: [
        densityRow('    引用密度: ', 'summary.lowRefEntries', summary.lowRefEntries, ' 个零引用 verified'),
        densityRow('    新鲜度: ', 'summary.staleEntries', summary.staleEntries, ' 个过期 draft'),
        { cells: [
          { label: '    消费追踪: ' },
          summary.consumptionData
            ? { label: '✓', tone: 'ok' }
            : { field: 'summary.consumptionData', text: '○ 未启用', tone: 'muted' },
        ] },
        blankLine(),
      ],
    },
    {
      title: '  飞轮指标:',
      rows: [
        { cells: [{ label: '    引用覆盖: ' }, { field: 'summary.refCoverage', text: `${summary.refCoverage}%` }] },
        { cells: [{ label: '    平均引用: ' }, { field: 'summary.avgRefs', text: String(summary.avgRefs) }] },
        blankLine(),
      ],
    },
    {
      title: '  问题 (前 20):',
      rows: issues.length === 0
        ? [{ cells: [{ label: '  ✓ 无问题', tone: 'ok' }] }]
        : [
          ...issues.slice(0, 20).map((issue, i) => ({
            cells: [
              { field: `issues.${i}.severity`, text: `    [${issue.severity}]`, tone: toneForSeverity(issue.severity) },
              { field: `issues.${i}.entry`, text: ` ${issue.entry}: ` },
              { field: `issues.${i}.detail`, text: issue.detail },
            ],
          })),
          // 溢出计数取全量数组，而 json 面的 issues 已截 50 条 → 无字段可锚，登记派生量
          ...(issues.length > 20
            ? [{ cells: [{ derived: 'healthIssuesOverflow', text: `    ... 还有 ${issues.length - 20} 条`, tone: 'muted' as const }] }]
            : []),
        ],
    },
  ];
}

function densityRow(prefix: string, field: string, count: number, suffix: string): DisplayRow {
  if (count === 0) return { cells: [{ label: prefix }, { label: '✓', tone: 'ok' }] };
  return {
    cells: [
      { label: prefix },
      { label: '⚠ ', tone: 'warn' },
      { field, text: String(count), tone: 'warn' },
      { label: suffix, tone: 'warn' },
    ],
  };
}

export async function knowledgeHealth(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeHealthView(options, io));
}
