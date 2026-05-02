/**
 * harness knowledge 命令
 *
 * 知识库管理：list、search、import、decay、stats
 */

import chalk from 'chalk';
import { KnowledgeStore } from '../../knowledge/store';
import { KnowledgeQuery } from '../../knowledge/query';
import { KnowledgeLifecycle } from '../../knowledge/lifecycle';
import { ColdStartImporter } from '../../knowledge/import';
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

  const byType: Record<string, number> = {};
  const byMaturity: Record<string, number> = {};
  const byLayer: Record<string, number> = {};

  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byMaturity[entry.maturity] = (byMaturity[entry.maturity] || 0) + 1;
    byLayer[entry.layer] = (byLayer[entry.layer] || 0) + 1;
  }

  if (options.json) {
    console.log(JSON.stringify({ total: entries.length, byType, byMaturity, byLayer }, null, 2));
    return;
  }

  console.log(chalk.blue(`📊 知识库统计\n`));
  console.log(chalk.bold(`  总计: ${entries.length} 条\n`));

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
}

function getKnowledgeDir(projectPath?: string): string {
  const base = projectPath || process.cwd();
  return `${base}/.harness/knowledge`;
}
