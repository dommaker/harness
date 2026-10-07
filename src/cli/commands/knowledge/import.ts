/**
 * harness knowledge import 子命令（冷启动导入；Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import { ColdStartImporter } from '../../../knowledge/cold-start';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  announce,
  blankLine,
  emitKnowledgeView,
  openKnowledgeStore,
  type DisplayModel,
  type DisplayRow,
} from '../knowledge-view';
import type { KnowledgeOptions } from './shared';

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
