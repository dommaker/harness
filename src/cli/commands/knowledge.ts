/**
 * harness knowledge 命令
 *
 * 知识库管理：list、search、import、decay、stats
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileKnowledgeStore as KnowledgeStore } from '../../knowledge/store';
import { KnowledgeQuery } from '../../knowledge/query';
import { KnowledgeLifecycle } from '../../knowledge/lifecycle';
import { ColdStartImporter } from '../../knowledge/import';
import { KnowledgeAudit } from '../../knowledge/audit';
import { migrateKnowledgeEntries } from '../../knowledge/migration';
import { KnowledgeIndexGenerator } from '../../knowledge/index-generator';
import type { KnowledgeType, MaturityLevel, QueryFilter } from '../../knowledge/types';

export interface KnowledgeOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 输出 JSON 格式 */
  json?: boolean;
}

/**
 * 知识库列表
 */
export async function knowledgeList(options: KnowledgeOptions & {
  type?: string;
  maturity?: string;
  tag?: string;
}): Promise<void> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath) });

  const filter: QueryFilter = { excludeArchived: false };
  if (options.type) {
    filter.types = options.type.split(',') as KnowledgeType[];
  }
  if (options.maturity) {
    filter.maturity = options.maturity.split(',') as MaturityLevel[];
  }
  if (options.tag) {
    filter.tags = options.tag.split(',');
  }

  const entries = store.list(filter);

  if (options.json) {
    console.log(JSON.stringify({ total: entries.length, entries }, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(chalk.yellow('知识库为空'));
    return;
  }

  console.log(chalk.blue(`📚 知识库 (${entries.length} 条)\n`));
  for (const entry of entries) {
    const maturityColor = entry.maturity === 'proven' ? chalk.green
      : entry.maturity === 'verified' ? chalk.cyan
      : entry.maturity === 'archived' ? chalk.gray
      : chalk.yellow;
    console.log(`  ${maturityColor(`[${entry.maturity}]`)} ${chalk.bold(entry.title)}`);
    console.log(`    ${chalk.gray(`id: ${entry.id} | type: ${entry.type} | layer: ${entry.layer}`)}`);
    if (entry.tags.length > 0) {
      console.log(`    ${chalk.gray(`tags: ${entry.tags.join(', ')}`)}`);
    }
  }
}

/**
 * 知识库搜索
 */
export async function knowledgeSearch(
  query: string,
  options: KnowledgeOptions & { limit?: number },
): Promise<void> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath) });
  const queryEngine = new KnowledgeQuery(store);

  const budget = {
    phase: 'cli',
    maxTokens: 10000,
    maxEntries: options.limit || 20,
    focusTypes: [] as KnowledgeType[],
  };

  const result = queryEngine.query(budget);

  // 简单文本匹配过滤
  const q = query.toLowerCase();
  const matched = result.entries.filter(e =>
    e.title.toLowerCase().includes(q) ||
    e.content.toLowerCase().includes(q) ||
    e.tags.some(t => t.toLowerCase().includes(q))
  );

  if (options.json) {
    console.log(JSON.stringify({ query, total: matched.length, entries: matched }, null, 2));
    return;
  }

  if (matched.length === 0) {
    console.log(chalk.yellow(`未找到匹配 "${query}" 的知识条目`));
    return;
  }

  console.log(chalk.blue(`🔍 搜索 "${query}" (${matched.length} 条结果)\n`));
  for (const entry of matched) {
    console.log(`  ${chalk.bold(entry.title)} ${chalk.gray(`[${entry.maturity}]`)}`);
    const preview = entry.content.slice(0, 100).replace(/\n/g, ' ');
    console.log(`    ${chalk.gray(preview)}${entry.content.length > 100 ? '...' : ''}`);
  }
}

/**
 * 知识库导入（冷启动）
 */
export async function knowledgeImport(
  options: KnowledgeOptions & { sources?: string; reset?: boolean },
): Promise<void> {
  const projectPath = options.projectPath || process.cwd();
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath) });

  const sources = options.sources
    ? options.sources.split(',') as Array<'code' | 'git' | 'docs' | 'manual'>
    : ['code', 'git', 'docs'] as Array<'code' | 'git' | 'docs'>;

  const importer = new ColdStartImporter({
    projectRoot: projectPath,
    store,
    sources,
  });

  if (options.reset) {
    importer.resetState();
    if (!options.json) {
      console.log(chalk.yellow('🔄 已重置导入状态'));
    }
  }

  if (!options.json) {
    console.log(chalk.blue(`📥 开始导入知识 (源: ${sources.join(', ')})...`));
  }

  const results = await importer.importAll();

  const totalImported = results.reduce((sum, r) => sum + r.entries.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  if (options.json) {
    console.log(JSON.stringify({ totalImported, totalErrors, results }, null, 2));
    return;
  }

  for (const result of results) {
    if (result.entries.length > 0) {
      console.log(chalk.green(`  ✅ ${result.source.type}: ${result.entries.length} 条`));
    }
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(chalk.red(`  ❌ ${result.source.type}: ${err.message}`));
      }
    }
  }

  console.log(chalk.green(`\n✅ 导入完成: ${totalImported} 条，${totalErrors} 个错误`));
}

/**
 * 知识库衰减周期
 */
export async function knowledgeDecay(options: KnowledgeOptions): Promise<void> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath) });
  const lifecycle = new KnowledgeLifecycle(store);

  if (!options.json) {
    console.log(chalk.blue('🔄 运行衰减周期...'));
  }

  const changes = lifecycle.runDecayCycle();

  if (options.json) {
    console.log(JSON.stringify({ changes }, null, 2));
    return;
  }

  if (changes.length === 0) {
    console.log(chalk.green('✅ 没有需要衰减的知识条目'));
    return;
  }

  console.log(chalk.yellow(`📉 ${changes.length} 条知识发生衰减:\n`));
  for (const change of changes) {
    console.log(`  ${change.entryId}: ${chalk.red(change.from)} → ${chalk.green(change.to)}`);
    console.log(`    ${chalk.gray(change.reason)}`);
  }
}

/**
 * 知识库统计
 */
export async function knowledgeStats(options: KnowledgeOptions): Promise<void> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath) });
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

  // D6 flywheel metrics
  const withRefs = active.filter(e => e.referencedBy.length > 0).length;
  const refCoverage = active.length > 0 ? Math.round(withRefs / active.length * 100) : 0;
  const avgRefs = active.length > 0
    ? Math.round(active.reduce((sum, e) => sum + e.referencedBy.length, 0) / active.length * 10) / 10
    : 0;
  let consumptionHitRate = 0;
  try {
    const statsPath = path.join(store.getBaseDir(), '.consumption-stats.json');
    if (fs.existsSync(statsPath)) {
      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
      const dailyEvents = stats.dailyEvents || 0;
      consumptionHitRate = active.length > 0 ? Math.min(Math.round(dailyEvents / active.length * 100), 100) : 0;
    }
  } catch { /* best-effort */ }

  const flywheel = { refCoverage, avgRefs, consumptionHitRate };

  if (options.json) {
    console.log(JSON.stringify({ total: entries.length, byType, byMaturity, byLayer, flywheel }, null, 2));
    return;
  }

  console.log(chalk.blue(`📊 知识库统计\n`));
  console.log(chalk.bold(`  总计: ${entries.length} 条 (活跃: ${active.length})\n`));

  console.log(chalk.bold('  按类型:'));
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${type}: ${count}`);
  }

  console.log(chalk.bold('\n  按成熟度:'));
  for (const [maturity, count] of Object.entries(byMaturity)) {
    const color = maturity === 'proven' ? chalk.green : maturity === 'archived' ? chalk.gray : chalk.yellow;
    console.log(`    ${color(maturity)}: ${count}`);
  }

  console.log(chalk.bold('\n  按层级:'));
  for (const [layer, count] of Object.entries(byLayer)) {
    console.log(`    ${layer}: ${count}`);
  }

  console.log(chalk.bold('\n  飞轮指标:'));
  console.log(`    引用覆盖: ${refCoverage}%`);
  console.log(`    平均引用: ${avgRefs}`);
  console.log(`    消费命中率: ${consumptionHitRate}%`);
}

export interface KnowledgeUpsertOptions {
  scope: string;
  title: string;
  content?: string;
  file?: string;
  type?: string;
  source?: string;
}

/**
 * 设计时知识沉淀：写入 KnowledgeStore + 同步 Prisma Document（Studio UI 可见）
 *
 * 调用 Studio API POST /api/knowledge/upsert（内部端点，无 auth）
 */
export async function knowledgeUpsert(options: KnowledgeUpsertOptions): Promise<void> {
  const apiPort = process.env.API_PORT || '3001';
  const url = `http://localhost:${apiPort}/api/knowledge/upsert`;

  // Read content from file if --file specified
  let content = options.content || '';
  if (options.file && !content) {
    try {
      content = fs.readFileSync(options.file, 'utf-8');
    } catch (e: any) {
      console.error(chalk.red(`Failed to read file: ${options.file}`));
      console.error(chalk.red(String(e)));
      process.exit(1);
    }
  }

  if (!options.scope || !options.title || !content) {
    console.error(chalk.red('--scope, --title, and --content (or --file) are required'));
    process.exit(1);
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: options.scope,
        title: options.title,
        content,
        type: options.type || 'architecture',
        source: options.source || 'cli',
      }),
    });

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({ error: res.statusText }));
      console.error(chalk.red(`API error ${res.status}: ${err.error || res.statusText}`));
      process.exit(1);
    }

    const result: any = await res.json();
    console.log(chalk.green(`✅ Knowledge upserted`));
    console.log(`   KnowledgeStore: ${result.knowledgeStore?.action} → ${result.knowledgeStore?.entryId}`);
    console.log(`   Studio UI: ${result.prismaDocument?.action} → ${result.prismaDocument?.docId || 'skipped'}`);
  } catch (e: any) {
    if (e?.code === 'ECONNREFUSED') {
      console.error(chalk.red(`Cannot reach Studio API at ${url}. Is the API running?`));
    } else {
      console.error(chalk.red(`Upsert failed: ${e.message}`));
    }
    process.exit(1);
  }
}

/**
/**
 * RAG 同步：扫描 .harness/knowledge-docs/ 输出需要 ingest 的文件列表
 */
export async function knowledgeSyncRag(options: KnowledgeOptions): Promise<void> {
  const projectPath = options.projectPath || process.cwd();
  const docsDir = `${projectPath}/.harness/knowledge-docs`;

  if (!fs.existsSync(docsDir)) {
    console.log(chalk.yellow('No .harness/knowledge-docs/ directory'));
    return;
  }

  const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    console.log(chalk.gray('No knowledge docs found'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({ directory: docsDir, files }, null, 2));
    return;
  }

  console.log(chalk.blue(`📄 RAG sync candidates: ${files.length} files in ${docsDir}\n`));
  for (const file of files) {
    console.log(chalk.cyan(`  ${file}`));
  }
  console.log();
  console.log(chalk.gray('Run `mcp__local-rag__ingest_file` for each to sync to RAG'));
}

/**
 * 知识同步状态：检测所有 tracked scope 的新鲜度
 */
export async function knowledgeSyncStatus(options: KnowledgeOptions): Promise<void> {
  const apiPort = process.env.API_PORT || '3001';
  const url = `http://localhost:${apiPort}/api/knowledge/sync-status`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({ error: res.statusText }));
      console.error(chalk.red(`API error ${res.status}: ${err.error || res.statusText}`));
      process.exit(1);
    }

    const data: any = await res.json();

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(chalk.blue(`🔄 KnowledgeSync Status\n`));
    console.log(chalk.bold(`Tracked scopes: ${data.trackedScopes?.join(', ') || 'none'}`));
    console.log(chalk.bold(`Stale entries: ${data.stale?.length || 0}`));

    if (data.stale?.length > 0) {
      console.log(chalk.yellow(`\n⚠️  Stale knowledge:\n`));
      for (const s of data.stale) {
        console.log(chalk.yellow(`  ${s.scope} (${s.title}): ${s.stalenessHours}h old, files changed: ${s.changedFiles.join(', ')}`));
      }
    } else {
      console.log(chalk.green('\n✅ All knowledge fresh'));
    }

    if (data.healed?.length > 0) {
      console.log(chalk.cyan(`\n🩹 Auto-healed: ${data.healed.join(', ')}`));
    }
  } catch (e: any) {
    if (e?.code === 'ECONNREFUSED') {
      console.error(chalk.red(`Cannot reach Studio API at ${url}`));
    } else {
      console.error(chalk.red(`Sync check failed: ${e.message}`));
    }
    process.exit(1);
  }
}

/**
 * 飞轮健康检查 — 零 token 检测知识飞轮数据流状态
 */
export async function knowledgeHealth(options: KnowledgeOptions & { dir?: string }): Promise<void> {
  const baseDir = options.dir || getKnowledgeDir(options.projectPath);
  const store = new KnowledgeStore({ baseDir });
  const entries = store.list({ excludeArchived: true });

  const issues: Array<{ severity: 'error' | 'warn' | 'info'; entry: string; detail: string }> = [];

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
  let consumptionData = false;
  const statsPath = path.join(baseDir, '.consumption-stats.json');
  if (fs.existsSync(statsPath)) {
    consumptionData = true;
  } else {
    issues.push({ severity: 'info', entry: '-', detail: `消费追踪数据不存在（${statsPath}）` });
  }

  // D4: 飞轮指标
  const withRefs = entries.filter(e => e.referencedBy.length > 0).length;
  const refCoverage = entries.length > 0 ? Math.round(withRefs / entries.length * 100) : 0;
  const avgRefs = entries.length > 0
    ? Math.round(entries.reduce((sum, e) => sum + e.referencedBy.length, 0) / entries.length * 10) / 10
    : 0;

  // 健康分计算
  const totalIssues = issues.filter(i => i.severity === 'error').length * 3
    + issues.filter(i => i.severity === 'warn').length * 1;
  const healthScore = Math.max(0, 100 - totalIssues);

  if (options.json) {
    console.log(JSON.stringify({
      healthScore,
      summary: {
        total: entries.length,
        lowRefEntries,
        staleEntries,
        consumptionData,
        refCoverage,
        avgRefs,
      },
      issues: issues.slice(0, 50),
    }, null, 2));
    return;
  }

  console.log(chalk.blue('🏥 飞轮健康检查\n'));
  console.log(chalk.bold(`  健康分: ${healthScore >= 80 ? chalk.green(healthScore) : healthScore >= 60 ? chalk.yellow(healthScore) : chalk.red(healthScore)}/100`));
  console.log(chalk.bold(`  活跃条目: ${entries.length}`));
  console.log();

  console.log(chalk.bold('  数据流状态:'));
  console.log(`    引用密度: ${lowRefEntries === 0 ? chalk.green('✓') : chalk.yellow(`⚠ ${lowRefEntries} 个零引用 verified`)}`);
  console.log(`    新鲜度: ${staleEntries === 0 ? chalk.green('✓') : chalk.yellow(`⚠ ${staleEntries} 个过期 draft`)}`);
  console.log(`    消费追踪: ${consumptionData ? chalk.green('✓') : chalk.gray('○ 未启用')}`);
  console.log();

  console.log(chalk.bold('  飞轮指标:'));
  console.log(`    引用覆盖: ${refCoverage}%`);
  console.log(`    平均引用: ${avgRefs}`);
  console.log();

  if (issues.length > 0) {
    console.log(chalk.bold(`  问题 (前 20):`));
    for (const issue of issues.slice(0, 20)) {
      const sevColor = issue.severity === 'error' ? chalk.red
        : issue.severity === 'warn' ? chalk.yellow
        : chalk.gray;
      console.log(`    ${sevColor(`[${issue.severity}]`)} ${issue.entry}: ${issue.detail}`);
    }
    if (issues.length > 20) {
      console.log(chalk.gray(`    ... 还有 ${issues.length - 20} 条`));
    }
  } else {
    console.log(chalk.green('  ✓ 无问题'));
  }
}

function getKnowledgeDir(projectPath?: string): string {
  if (projectPath) return `${projectPath}/.harness/knowledge`;
  if (process.env.KNOWLEDGE_BASE_DIR) return process.env.KNOWLEDGE_BASE_DIR;
  return path.join(os.homedir(), '.studio', 'knowledge');
}

/**
 * 知识库质量审计
 */
export async function knowledgeAudit(options: KnowledgeOptions & {
  fix?: boolean;
  dryRun?: boolean;
  threshold?: number;
  dir?: string;
}): Promise<void> {
  const audit = new KnowledgeAudit({
    baseDir: options.dir || getKnowledgeDir(options.projectPath),
    shortContentThreshold: options.threshold ? parseInt(options.threshold as any, 10) : undefined,
  });

  const isDryRun = options.dryRun && !options.fix;

  if (!options.json && !isDryRun) {
    console.log(chalk.blue('🔍 知识库质量审计...\n'));
  }

  const report = audit.run({ autoFix: options.fix && !isDryRun });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Summary
  console.log(chalk.bold(`  总条目: ${report.totalEntries}`));
  console.log(chalk.bold(`  健康分: ${report.healthScore.before}/100`));
  if (report.autoFixed > 0) {
    console.log(chalk.green(`  自动修复: ${report.autoFixed} 条`));
    console.log(chalk.bold(`  修复后: ${report.healthScore.after}/100`));
  }
  console.log();

  // Dimension scores
  const dimLabels: Record<string, string> = {
    structure: 'D1 结构完整性',
    content: 'D2 内容质量',
    dedup: 'D3 去重有效性',
    maturity: 'D4 成熟度健康',
    freshness: 'D5 新鲜度',
    flywheel: 'D6 飞轮验证',
  };
  console.log(chalk.bold('  维度评分:'));
  for (const [key, dim] of Object.entries(report.dimensions)) {
    const label = dimLabels[key] || key;
    const scoreColor = dim.score >= 80 ? chalk.green : dim.score >= 60 ? chalk.yellow : chalk.red;
    console.log(`    ${label}: ${scoreColor(`${dim.score}/100`)} (${dim.issues} 问题)`);
  }
  console.log();

  // Issues by rule
  const ruleLabels: Record<string, string> = {
    'frontmatter-missing': 'frontmatter 缺失',
    'test-data-pollution': '测试数据污染',
    'daily-audit-noise': '每日审计噪音',
    'zero-content-proven': '零内容 proven',
    'short-content': '短内容',
    'maturity-inflation': '成熟度虚高',
    'title-duplicate': '标题重复',
    'source-refs-bloat': 'sourceReferences 膨胀',
    'fragment-cluster': '碎片集群',
    'promotion-blocked': 'promotion 受阻',
    'orphan-draft': '孤儿 draft',
    'stale-entry': '过期条目',
  };

  for (const [rule, count] of Object.entries(report.summary)) {
    if (count === 0) continue;
    const label = ruleLabels[rule] || rule;
    console.log(`  ${chalk.red(`${label}: ${count}`)}`);
  }

  // Detail (first 20)
  if (report.issues.length > 0) {
    console.log(chalk.bold(`\n  问题详情 (前 20 条):\n`));
    for (const issue of report.issues.slice(0, 20)) {
      const severityColor = issue.severity === 'critical' ? chalk.red
        : issue.severity === 'high' ? chalk.yellow
        : chalk.gray;
      console.log(`  ${severityColor(`[${issue.severity}]`)} ${issue.entryId}: ${issue.title}`);
      console.log(`    ${chalk.gray(issue.detail)} → ${issue.action}`);
    }
    if (report.issues.length > 20) {
      console.log(chalk.gray(`\n  ... 还有 ${report.issues.length - 20} 条`));
    }
  }

  if (!options.fix && report.issues.length > 0) {
    console.log(chalk.yellow(`\n  使用 --fix 自动修复`));
  }

  // Auto-rebuild index after audit (files may have changed)
  const baseDir = options.dir || getKnowledgeDir(options.projectPath);
  const idxGen = new KnowledgeIndexGenerator(baseDir);
  idxGen.regenerate();
  if (!options.json) {
    console.log(chalk.gray(`  📇 索引已重建`));
  }
}

/**
 * 知识库快照（KR4 存活率追踪）
 */
export function knowledgeSnapshot(options: KnowledgeOptions & { dir?: string }): void {
  const store = new KnowledgeStore({ baseDir: options.dir || getKnowledgeDir(options.projectPath) });
  const snapPath = store.snapshot();

  if (options.json) {
    console.log(JSON.stringify({ snapshotPath: snapPath }));
    return;
  }

  console.log(chalk.green(`✅ 快照已保存: ${snapPath}`));
}

/**
 * 知识库迁移 — 为现有条目添加 AS-021 新字段
 */
export function knowledgeMigrate(options: KnowledgeOptions & { dir?: string }): void {
  const baseDir = options.dir || getKnowledgeDir(options.projectPath);

  if (options.json) {
    const result = migrateKnowledgeEntries(baseDir);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.blue('🔄 迁移知识条目（添加 consumptionMode/origin 字段）\n'));
  const result = migrateKnowledgeEntries(baseDir);

  console.log(chalk.green(`  总计: ${result.total} 条`));
  console.log(chalk.green(`  已迁移: ${result.migrated} 条`));
  console.log(chalk.gray(`  已跳过: ${result.skipped} 条`));

  if (result.errors.length > 0) {
    console.log(chalk.red(`\n  错误: ${result.errors.length} 条`));
    for (const err of result.errors.slice(0, 5)) {
      console.log(chalk.red(`    ${err}`));
    }
  }

  if (result.migrated === 0 && result.errors.length === 0) {
    console.log(chalk.green('\n✅ 所有条目已是最新，无需迁移'));
  } else if (result.migrated > 0) {
    console.log(chalk.green(`\n✅ 迁移完成`));
  }
}

/**
 * 知识库索引重建 — 生成 _index.md 供 Agent grep 使用，同时同步 index.json
 */
export function knowledgeIndex(options: KnowledgeOptions & { dir?: string }): void {
  const baseDir = options.dir || getKnowledgeDir(options.projectPath);
  const gen = new KnowledgeIndexGenerator(baseDir);

  const beforeSize = (() => {
    const indexPath = path.join(baseDir, '_index.md');
    return fs.existsSync(indexPath) ? fs.statSync(indexPath).size : 0;
  })();

  const output = gen.regenerate();

  // Sync index.json from disk files (removes ghost entries from manual mv/rm)
  const store = new KnowledgeStore({ baseDir });
  store.rebuildIndex();

  const afterSize = Buffer.byteLength(output, 'utf-8');
  const lineCount = output.split('\n').filter(l => !l.startsWith('#')).length;

  if (options.json) {
    console.log(JSON.stringify({
      path: path.join(baseDir, '_index.md'),
      entries: lineCount,
      size: afterSize,
      previousSize: beforeSize,
    }));
    return;
  }

  console.log(chalk.blue(`📇 索引已重建`));
  console.log(chalk.gray(`  路径: ${path.join(baseDir, '_index.md')}`));
  console.log(chalk.green(`  条目: ${lineCount}`));
  console.log(chalk.green(`  大小: ${(afterSize / 1024).toFixed(1)} KB`));
  if (beforeSize > 0) {
    console.log(chalk.gray(`  旧大小: ${(beforeSize / 1024).toFixed(1)} KB`));
  }
}
