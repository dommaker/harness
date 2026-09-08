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
import { KnowledgeAudit, AUDIT_RULE_LABELS } from '../../knowledge/audit';
import type { AuditReport, AuditRuleName } from '../../knowledge/audit';
import { evaluateFlywheel } from '../../knowledge/flywheel-metrics';
import { migrateKnowledgeEntries } from '../../knowledge/migration';
import { KnowledgeIndexGenerator } from '../../knowledge/index-generator';
import type { KnowledgeSubsystem, MaturityLevel, QueryFilter } from '../../knowledge/types';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

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
}, io: CommandIO = processIO): Promise<CommandResult> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath, io) });

  const filter: QueryFilter = { excludeArchived: false };
  if (options.type) {
    filter.types = options.type.split(',') as KnowledgeSubsystem[];
  }
  if (options.maturity) {
    filter.maturity = options.maturity.split(',') as MaturityLevel[];
  }
  if (options.tag) {
    filter.tags = options.tag.split(',');
  }

  const entries = store.list(filter);

  if (options.json) {
    log(io, JSON.stringify({ total: entries.length, entries }, null, 2));
    return { kind: 'ok' };
  }

  if (entries.length === 0) {
    log(io, chalk.yellow('知识库为空'));
    return { kind: 'ok' };
  }

  log(io, chalk.blue(`📚 知识库 (${entries.length} 条)\n`));
  for (const entry of entries) {
    const maturityColor = entry.maturity === 'proven' ? chalk.green
      : entry.maturity === 'verified' ? chalk.cyan
      : entry.maturity === 'archived' ? chalk.gray
      : chalk.yellow;
    log(io, `  ${maturityColor(`[${entry.maturity}]`)} ${chalk.bold(entry.title)}`);
    log(io, `    ${chalk.gray(`id: ${entry.id} | type: ${entry.type} | layer: ${entry.layer}`)}`);
    if (entry.tags.length > 0) {
      log(io, `    ${chalk.gray(`tags: ${entry.tags.join(', ')}`)}`);
    }
  }
  return { kind: 'ok' };
}

/**
 * 知识库搜索
 */
export async function knowledgeSearch(
  query: string,
  options: KnowledgeOptions & { limit?: number },
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath, io) });
  const queryEngine = new KnowledgeQuery(store);

  const matched = queryEngine.search(query, { limit: options.limit || 20 });

  if (options.json) {
    log(io, JSON.stringify({ query, total: matched.length, entries: matched }, null, 2));
    return { kind: 'ok' };
  }

  if (matched.length === 0) {
    log(io, chalk.yellow(`未找到匹配 "${query}" 的知识条目`));
    return { kind: 'ok' };
  }

  log(io, chalk.blue(`🔍 搜索 "${query}" (${matched.length} 条结果)\n`));
  for (const entry of matched) {
    log(io, `  ${chalk.bold(entry.title)} ${chalk.gray(`[${entry.maturity}]`)}`);
    const preview = entry.content.slice(0, 100).replace(/\n/g, ' ');
    log(io, `    ${chalk.gray(preview)}${entry.content.length > 100 ? '...' : ''}`);
  }
  return { kind: 'ok' };
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

/**
 * 知识库导入（冷启动）
 */
export async function knowledgeImport(
  options: KnowledgeOptions & { sources?: string; reset?: boolean },
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectPath = options.projectPath || process.cwd();
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath, io) });

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
      log(io, chalk.yellow('🔄 已重置导入状态'));
    }
  }

  if (!options.json) {
    log(io, chalk.blue(`📥 开始导入知识 (源: ${sources.join(', ')})...`));
  }

  const results = await importer.importAll();

  const totalImported = results.reduce((sum, r) => sum + r.entries.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  if (options.json) {
    log(io, JSON.stringify({ totalImported, totalErrors, results }, null, 2));
    return { kind: 'ok' };
  }

  for (const result of results) {
    if (result.entries.length > 0) {
      log(io, chalk.green(`  ✅ ${result.source.type}: ${result.entries.length} 条`));
    }
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        log(io, chalk.red(`  ❌ ${result.source.type}: ${err.message}`));
      }
    }
  }

  log(io, chalk.green(`\n✅ 导入完成: ${totalImported} 条，${totalErrors} 个错误`));
  return { kind: 'ok' };
}

/**
 * 知识库衰减周期
 */
export async function knowledgeDecay(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath, io) });
  const lifecycle = new KnowledgeLifecycle(store);

  if (!options.json) {
    log(io, chalk.blue('🔄 运行衰减周期...'));
  }

  const changes = lifecycle.runDecayCycle();

  if (options.json) {
    log(io, JSON.stringify({ changes }, null, 2));
    return { kind: 'ok' };
  }

  if (changes.length === 0) {
    log(io, chalk.green('✅ 没有需要衰减的知识条目'));
    return { kind: 'ok' };
  }

  log(io, chalk.yellow(`📉 ${changes.length} 条知识发生衰减:\n`));
  for (const change of changes) {
    log(io, `  ${change.entryId}: ${chalk.red(change.from)} → ${chalk.green(change.to)}`);
    log(io, `    ${chalk.gray(change.reason)}`);
  }
  return { kind: 'ok' };
}

/**
 * 知识库统计
 */
export async function knowledgeStats(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const store = new KnowledgeStore({ baseDir: getKnowledgeDir(options.projectPath, io) });
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
  const refCoverage = Math.round(metrics.refCoverage * 100);
  const avgRefs = Math.round(metrics.avgRefs * 10) / 10;
  const consumptionHitRate = Math.round(metrics.consumptionHitRate * 100);

  const flywheel = { refCoverage, avgRefs, consumptionHitRate };

  if (options.json) {
    log(io, JSON.stringify({ total: entries.length, byType, byMaturity, byLayer, flywheel }, null, 2));
    return { kind: 'ok' };
  }

  log(io, chalk.blue(`📊 知识库统计\n`));
  log(io, chalk.bold(`  总计: ${entries.length} 条 (活跃: ${active.length})\n`));

  log(io, chalk.bold('  按类型:'));
  for (const [type, count] of Object.entries(byType)) {
    log(io, `    ${type}: ${count}`);
  }

  log(io, chalk.bold('\n  按成熟度:'));
  for (const [maturity, count] of Object.entries(byMaturity)) {
    const color = maturity === 'proven' ? chalk.green : maturity === 'archived' ? chalk.gray : chalk.yellow;
    log(io, `    ${color(maturity)}: ${count}`);
  }

  log(io, chalk.bold('\n  按层级:'));
  for (const [layer, count] of Object.entries(byLayer)) {
    log(io, `    ${layer}: ${count}`);
  }

  log(io, chalk.bold('\n  飞轮指标:'));
  log(io, `    引用覆盖: ${refCoverage}%`);
  log(io, `    平均引用: ${avgRefs}`);
  log(io, `    消费命中率: ${consumptionHitRate}%`);
  return { kind: 'ok' };
}

/**
 * RAG 同步：扫描 .harness/knowledge-docs/ 输出需要 ingest 的文件列表
 */
export async function knowledgeSyncRag(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const projectPath = options.projectPath || process.cwd();
  const docsDir = `${projectPath}/.harness/knowledge-docs`;

  if (!fs.existsSync(docsDir)) {
    log(io, chalk.yellow('No .harness/knowledge-docs/ directory'));
    return { kind: 'ok' };
  }

  const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    log(io, chalk.gray('No knowledge docs found'));
    return { kind: 'ok' };
  }

  if (options.json) {
    log(io, JSON.stringify({ directory: docsDir, files }, null, 2));
    return { kind: 'ok' };
  }

  log(io, chalk.blue(`📄 RAG sync candidates: ${files.length} files in ${docsDir}\n`));
  for (const file of files) {
    log(io, chalk.cyan(`  ${file}`));
  }
  log(io);
  log(io, chalk.gray('Run `mcp__local-rag__ingest_file` for each to sync to RAG'));
  return { kind: 'ok' };
}

/**
 * 飞轮健康检查 — 零 token 检测知识飞轮数据流状态
 */
export async function knowledgeHealth(options: KnowledgeOptions & { dir?: string }, io: CommandIO = processIO): Promise<CommandResult> {
  const baseDir = options.dir || getKnowledgeDir(options.projectPath, io);
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

  // D4: 飞轮指标（计算唯一实现在 knowledge/flywheel-metrics；人口为本命令的 excludeArchived 切片）
  const metrics = evaluateFlywheel({ entries });
  const refCoverage = Math.round(metrics.refCoverage * 100);
  const avgRefs = Math.round(metrics.avgRefs * 10) / 10;

  // 健康分计算
  const totalIssues = issues.filter(i => i.severity === 'error').length * 3
    + issues.filter(i => i.severity === 'warn').length * 1;
  const healthScore = Math.max(0, 100 - totalIssues);

  if (options.json) {
    log(io, JSON.stringify({
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
    return { kind: 'ok' };
  }

  log(io, chalk.blue('🏥 飞轮健康检查\n'));
  log(io, chalk.bold(`  健康分: ${healthScore >= 80 ? chalk.green(healthScore) : healthScore >= 60 ? chalk.yellow(healthScore) : chalk.red(healthScore)}/100`));
  log(io, chalk.bold(`  活跃条目: ${entries.length}`));
  log(io);

  log(io, chalk.bold('  数据流状态:'));
  log(io, `    引用密度: ${lowRefEntries === 0 ? chalk.green('✓') : chalk.yellow(`⚠ ${lowRefEntries} 个零引用 verified`)}`);
  log(io, `    新鲜度: ${staleEntries === 0 ? chalk.green('✓') : chalk.yellow(`⚠ ${staleEntries} 个过期 draft`)}`);
  log(io, `    消费追踪: ${consumptionData ? chalk.green('✓') : chalk.gray('○ 未启用')}`);
  log(io);

  log(io, chalk.bold('  飞轮指标:'));
  log(io, `    引用覆盖: ${refCoverage}%`);
  log(io, `    平均引用: ${avgRefs}`);
  log(io);

  if (issues.length > 0) {
    log(io, chalk.bold(`  问题 (前 20):`));
    for (const issue of issues.slice(0, 20)) {
      const sevColor = issue.severity === 'error' ? chalk.red
        : issue.severity === 'warn' ? chalk.yellow
        : chalk.gray;
      log(io, `    ${sevColor(`[${issue.severity}]`)} ${issue.entry}: ${issue.detail}`);
    }
    if (issues.length > 20) {
      log(io, chalk.gray(`    ... 还有 ${issues.length - 20} 条`));
    }
  } else {
    log(io, chalk.green('  ✓ 无问题'));
  }
  return { kind: 'ok' };
}

/** 缺省知识库数据根（相对用户 home） */
const KNOWLEDGE_DATA_DIR = path.join('.harness', 'knowledge');
/** 旧缺省数据根（曾寄居 studio home），仍有数据时兼容沿用，免迁移 */
const LEGACY_KNOWLEDGE_DATA_DIR = path.join('.studio', 'knowledge');

let legacyKnowledgeDirNotified = false;

function hasKnowledgeData(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function getKnowledgeDir(projectPath: string | undefined, io: CommandIO): string {
  if (projectPath) return `${projectPath}/.harness/knowledge`;
  if (process.env.KNOWLEDGE_BASE_DIR) return process.env.KNOWLEDGE_BASE_DIR;
  const defaultDir = path.join(os.homedir(), KNOWLEDGE_DATA_DIR);
  const legacyDir = path.join(os.homedir(), LEGACY_KNOWLEDGE_DATA_DIR);
  if (hasKnowledgeData(legacyDir)) {
    if (!legacyKnowledgeDirNotified) {
      legacyKnowledgeDirNotified = true;
      // stderr：不污染 --json 的 stdout 输出
      logError(io, chalk.yellow(`⚠ 缺省知识库根已改为 ${defaultDir}；旧目录 ${legacyDir} 仍有数据，本次沿用（免迁移，可用 KNOWLEDGE_BASE_DIR 覆盖）`));
    }
    return legacyDir;
  }
  return defaultDir;
}

/**
 * 知识库质量审计
 */
export async function knowledgeAudit(options: KnowledgeOptions & {
  fix?: boolean;
  dryRun?: boolean;
  threshold?: number;
  dir?: string;
}, io: CommandIO = processIO): Promise<CommandResult> {
  const audit = new KnowledgeAudit({
    baseDir: options.dir || getKnowledgeDir(options.projectPath, io),
    shortContentThreshold: options.threshold ? parseInt(options.threshold as any, 10) : undefined,
  });

  const isDryRun = options.dryRun && !options.fix;

  if (!options.json && !isDryRun) {
    log(io, chalk.blue('🔍 知识库质量审计...\n'));
  }

  const report = audit.run({ autoFix: options.fix && !isDryRun });

  if (options.json) {
    log(io, JSON.stringify(report, null, 2));
    return { kind: 'ok' };
  }

  // Summary
  log(io, chalk.bold(`  总条目: ${report.totalEntries}`));
  log(io, chalk.bold(`  健康分: ${report.healthScore.before}/100`));
  if (report.autoFixed > 0) {
    log(io, chalk.green(`  自动修复: ${report.autoFixed} 条`));
    log(io, chalk.bold(`  修复后: ${report.healthScore.after}/100`));
  }
  log(io);

  // Dimension scores（Record 全键标注 → 编译期闭环，#109）
  const dimLabels: Record<keyof AuditReport['dimensions'], string> = {
    structure: 'D1 结构完整性',
    content: 'D2 内容质量',
    dedup: 'D3 去重有效性',
    maturity: 'D4 成熟度健康',
    freshness: 'D5 新鲜度',
    flywheel: 'D6 飞轮验证',
    incremental: 'D7 增量存活',
  };
  log(io, chalk.bold('  维度评分:'));
  for (const [key, dim] of Object.entries(report.dimensions)) {
    const label = dimLabels[key as keyof AuditReport['dimensions']];
    const scoreColor = dim.score >= 80 ? chalk.green : dim.score >= 60 ? chalk.yellow : chalk.red;
    log(io, `    ${label}: ${scoreColor(`${dim.score}/100`)} (${dim.issues} 问题)`);
  }
  log(io);

  // Issues by rule（label 正本在 audit.ts 规则定义，AUDIT_RULE_LABELS 编译期闭环，#109）
  for (const [rule, count] of Object.entries(report.summary)) {
    if (count === 0) continue;
    const label = AUDIT_RULE_LABELS[rule as AuditRuleName];
    log(io, `  ${chalk.red(`${label}: ${count}`)}`);
  }

  // Detail (first 20)
  if (report.issues.length > 0) {
    log(io, chalk.bold(`\n  问题详情 (前 20 条):\n`));
    for (const issue of report.issues.slice(0, 20)) {
      const severityColor = issue.severity === 'critical' ? chalk.red
        : issue.severity === 'high' ? chalk.yellow
        : chalk.gray;
      log(io, `  ${severityColor(`[${issue.severity}]`)} ${issue.entryId}: ${issue.title}`);
      log(io, `    ${chalk.gray(issue.detail)} → ${issue.action}`);
    }
    if (report.issues.length > 20) {
      log(io, chalk.gray(`\n  ... 还有 ${report.issues.length - 20} 条`));
    }
  }

  if (!options.fix && report.issues.length > 0) {
    log(io, chalk.yellow(`\n  使用 --fix 自动修复`));
  }

  // Auto-rebuild index after audit (files may have changed)
  const baseDir = options.dir || getKnowledgeDir(options.projectPath, io);
  const idxGen = new KnowledgeIndexGenerator(baseDir);
  idxGen.regenerate();
  if (!options.json) {
    log(io, chalk.gray(`  📇 索引已重建`));
  }
  return { kind: 'ok' };
}

/**
 * 知识库快照（KR4 存活率追踪）
 */
export function knowledgeSnapshot(options: KnowledgeOptions & { dir?: string }, io: CommandIO = processIO): CommandResult {
  const store = new KnowledgeStore({ baseDir: options.dir || getKnowledgeDir(options.projectPath, io) });
  const snapPath = store.snapshot();

  if (options.json) {
    log(io, JSON.stringify({ snapshotPath: snapPath }));
    return { kind: 'ok' };
  }

  log(io, chalk.green(`✅ 快照已保存: ${snapPath}`));
  return { kind: 'ok' };
}

/**
 * 知识库迁移 — 为现有条目添加 AS-021 新字段
 */
export function knowledgeMigrate(options: KnowledgeOptions & { dir?: string }, io: CommandIO = processIO): CommandResult {
  const baseDir = options.dir || getKnowledgeDir(options.projectPath, io);

  if (options.json) {
    const result = migrateKnowledgeEntries(baseDir);
    log(io, JSON.stringify(result, null, 2));
    return { kind: 'ok' };
  }

  log(io, chalk.blue('🔄 迁移知识条目（添加 consumptionMode/origin 字段）\n'));
  const result = migrateKnowledgeEntries(baseDir);

  log(io, chalk.green(`  总计: ${result.total} 条`));
  log(io, chalk.green(`  已迁移: ${result.migrated} 条`));
  log(io, chalk.gray(`  已跳过: ${result.skipped} 条`));

  if (result.errors.length > 0) {
    log(io, chalk.red(`\n  错误: ${result.errors.length} 条`));
    for (const err of result.errors.slice(0, 5)) {
      log(io, chalk.red(`    ${err}`));
    }
  }

  if (result.migrated === 0 && result.errors.length === 0) {
    log(io, chalk.green('\n✅ 所有条目已是最新，无需迁移'));
  } else if (result.migrated > 0) {
    log(io, chalk.green(`\n✅ 迁移完成`));
  }
  return { kind: 'ok' };
}

/**
 * 知识库索引重建 — 生成 _index.md 供 Agent grep 使用，同时同步 index.json
 */
export function knowledgeIndex(options: KnowledgeOptions & { dir?: string }, io: CommandIO = processIO): CommandResult {
  const baseDir = options.dir || getKnowledgeDir(options.projectPath, io);
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
    log(io, JSON.stringify({
      path: path.join(baseDir, '_index.md'),
      entries: lineCount,
      size: afterSize,
      previousSize: beforeSize,
    }));
    return { kind: 'ok' };
  }

  log(io, chalk.blue(`📇 索引已重建`));
  log(io, chalk.gray(`  路径: ${path.join(baseDir, '_index.md')}`));
  log(io, chalk.green(`  条目: ${lineCount}`));
  log(io, chalk.green(`  大小: ${(afterSize / 1024).toFixed(1)} KB`));
  if (beforeSize > 0) {
    log(io, chalk.gray(`  旧大小: ${(beforeSize / 1024).toFixed(1)} KB`));
  }
  return { kind: 'ok' };
}
