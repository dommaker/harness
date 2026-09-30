/**
 * harness knowledge decay 子命令（Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、label 映射、json/人读分派、退出码、路径解析与 store 构造
 * 统一在 knowledge-view.ts（harness#133，架构评审候选4）。
 */

import { KnowledgeLifecycle } from '../../../knowledge/lifecycle';
import type { MaturityChange } from '../../../knowledge/types';
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
