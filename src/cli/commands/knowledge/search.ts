/**
 * harness knowledge search 子命令（Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import { KnowledgeQuery } from '../../../knowledge/query';
import type { KnowledgeEntry } from '../../../knowledge/types';
import { logError, processIO, type CommandIO, type CommandResult } from '../../command-contract';
import { parseNumericFlagOrReport } from '../../../utils/numeric-flag';
import {
  blankLine,
  emitKnowledgeView,
  openKnowledgeStore,
  type DisplayModel,
  type DisplayRow,
} from '../knowledge-view';
import type { KnowledgeOptions } from './shared';

export function knowledgeSearchView(
  query: string,
  options: KnowledgeOptions & { limit?: number },
  io: CommandIO,
) {
  const store = openKnowledgeStore(options, io);
  const matched = new KnowledgeQuery(store).search(query, { limit: options.limit ?? 20 });
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
 * knowledge search 子命令入口（候选7）：缺参闸门 + limit 装配窄化，
 * 自 definitions.ts 的 args 复印块移回命令模块（interface/测试面所在）。
 * `--limit` 给到的恒是字符串（缺省 '20' 也是），脏输入 fail-loud（harness#154，
 * 原先 parseInt 出 NaN 被下游 `|| 20` 静默兜成缺省量）。
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
  const limit = parseNumericFlagOrReport(io, '--limit', options.limit as string | undefined, 'int');
  if (!limit.ok) {
    return { kind: 'usage-error', reason: `knowledge search --limit 非法限制: "${limit.raw}"` };
  }
  return knowledgeSearch(String(query), {
    projectPath: options.projectPath as string | undefined,
    json: options.json as boolean | undefined,
    limit: limit.value,
  }, io);
}
