/**
 * harness knowledge snapshot 子命令（KR4 存活率追踪；Phase 3 自 knowledge.ts 拆出，纯移位）
 *
 * 本文件只做「取数 + 声明两投影」：json 面正本在 `data`，人读排版在 `human()` 的
 * display model。上色、json/人读分派、退出码、路径解析与 store 构造统一在
 * knowledge-view.ts（harness#133，架构评审候选4）。
 */

import { processIO, type CommandIO, type CommandResult } from '../../command-contract';
import {
  emitKnowledgeView,
  openKnowledgeStore,
  type DisplayModel,
} from '../knowledge-view';
import type { KnowledgeDirOption, KnowledgeOptions } from './shared';

export function knowledgeSnapshotView(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO) {
  const snapshotPath = openKnowledgeStore(options, io).snapshot();
  const data = { snapshotPath };

  return {
    data,
    human: (): DisplayModel => ({
      sections: [{
        rows: [{
          cells: [
            { label: '✅ 快照已保存: ', tone: 'ok' },
            { field: 'snapshotPath', text: snapshotPath, tone: 'ok' },
          ],
        }],
      }],
    }),
  };
}

export function knowledgeSnapshot(options: KnowledgeOptions & KnowledgeDirOption, io: CommandIO = processIO): CommandResult {
  return emitKnowledgeView(io, options, knowledgeSnapshotView(options, io));
}
