/**
 * harness knowledge list 子命令（Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import type { KnowledgeEntry, KnowledgeSubsystem, MaturityLevel, QueryFilter } from '../../../knowledge/types';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  blankLine,
  emitKnowledgeView,
  openKnowledgeStore,
  toneForMaturity,
  type DisplayModel,
  type DisplayRow,
} from '../knowledge-view';
import type { KnowledgeOptions } from './shared';

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
