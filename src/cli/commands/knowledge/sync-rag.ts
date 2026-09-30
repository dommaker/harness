/**
 * harness knowledge sync-rag 子命令（Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码统一在 knowledge-view.ts
 * （harness#133，架构评审候选4）。
 */

import * as fs from 'fs';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  blankLine,
  emitKnowledgeView,
  type DisplayModel,
  type DisplayRow,
} from '../knowledge-view';
import type { KnowledgeOptions } from './shared';

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
    { cells: [{ label: 'Ingest each file into your own knowledge-base backend to sync to RAG', tone: 'muted' }] },
  ];
}

export async function knowledgeSyncRag(options: KnowledgeOptions, io: CommandIO = processIO): Promise<CommandResult> {
  return emitKnowledgeView(io, options, knowledgeSyncRagView(options));
}
