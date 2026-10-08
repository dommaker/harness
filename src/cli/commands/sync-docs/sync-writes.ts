/**
 * sync-docs 主流程的写入自愈段（ADR-0040 Phase 3 自 main-flow.ts 拆段，纯移位）：
 * CAPABILITIES.md（计数 / 条目与排版）→ CONTEXT.md 缺失创建 → AGENTS.md 写入。
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { updateCapabilityCounts, type CapabilityDefinitionSource } from '../../../core/constraints/capabilities-parser';
import { updateCapabilitiesFile } from './capabilities-syncer';
import { createContextMd } from './context-syncer';
import type { SyncState, SyncVerdict } from './sync-state';
import { log, type CommandIO } from '../../command-contract';

/**
 * 写入段：按判定旗标自愈被管理文档（只在写入模式被调用）
 */
export async function applySyncWrites(
  io: CommandIO,
  state: SyncState,
  verdict: SyncVerdict,
  definitions: CapabilityDefinitionSource
): Promise<void> {
  if (state.capsIsCapabilityListing && verdict.hasCapIssues) {
    const updated = updateCapabilityCounts(state.capsContent, definitions);
    await fs.writeFile(state.capabilitiesPath, updated, 'utf-8');
    log(io, chalk.green(`\n✅ 已更新 CAPABILITIES.md 计数`));
  }

  if (!state.capsIsCapabilityListing && verdict.hasTableIssues) {
    await updateCapabilitiesFile(
      state.capabilitiesPath,
      state.currentModules,
      state.existingFiles,
      state.result,
      state.capsMode
    );
    log(io, chalk.green(`\n✅ 已更新 CAPABILITIES.md`));
  }

  for (const dir of state.result.contextMissing) {
    await createContextMd(state.projectPath, dir, io);
  }

  if (verdict.hasAgentsIssues && state.agentsMdExpected !== null) {
    await fs.writeFile(path.join(state.projectPath, 'AGENTS.md'), state.agentsMdExpected, 'utf-8');
    log(io, chalk.green(state.agentsMdExists ? `✅ 已更新 AGENTS.md` : `✅ 已生成 AGENTS.md`));
  }
}
