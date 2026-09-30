/**
 * harness knowledge index 子命令（重建 _index.md 供 Agent grep，并同步 index.json；
 * Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 注意：本文件是 `index` 子命令的实现，不是 knowledge/ 目录的 barrel——子命令
 * 实现由 definitions.ts 按 module+export 逐个懒加载引用，无聚合出口。
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、json/人读分派、退出码、路径解析与 store 构造统一在
 * knowledge-view.ts（harness#133，架构评审候选4）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeIndexGenerator } from '../../../knowledge/index-generator';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  emitKnowledgeView,
  openKnowledgeStore,
  resolveKnowledgeBaseDir,
  type DisplayModel,
  type DisplayRow,
} from '../knowledge-view';
import type { KnowledgeDirOption, KnowledgeOptions } from './shared';

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
