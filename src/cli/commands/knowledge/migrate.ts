/**
 * harness knowledge migrate 子命令（为现有条目补 AS-021 新字段；Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、json/人读分派、退出码、路径解析统一在 knowledge-view.ts
 * （harness#133，架构评审候选4）。
 */

import { migrateKnowledgeEntries } from '../../../knowledge/migration';
import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  blankLine,
  emitKnowledgeView,
  resolveKnowledgeBaseDir,
  type DisplayModel,
  type DisplayRow,
  type KnowledgeView,
} from '../knowledge-view';
import type { KnowledgeDirOption, KnowledgeOptions } from './shared';

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
