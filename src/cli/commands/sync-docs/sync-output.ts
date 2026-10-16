/**
 * sync-docs 主流程的报告出口（ADR-0040 Phase 3 自 main-flow.ts 拆段，纯移位）：
 * --json 结构化输出（供 LLM 消费）与人读输出，两枚各吃采集态 + 判定旗标。
 */

import chalk from 'chalk';
import * as path from 'path';
import type { SyncDocsOptions, SyncState, SyncVerdict, TableLayoutVerdict } from './sync-state';
import type { ContextContentDrift, ModuleInfo } from './project-reader';
import { log, type CommandIO } from '../../command-contract';

/**
 * --json 结构化报告形状（重构班次 3 Phase 4 具名化）
 *
 * 原 `Record<string, unknown>` 宽类型令每处 resolution push 都要重复
 * `as Array<Record<string, unknown>>` 强转（6 处）；具名接口后字段直接定型。
 * 键的赋值顺序 = 输出键序（JSON.stringify 按插入序），段落函数不得打乱。
 */
interface SyncJsonReport {
  stale: boolean;
  format: 'capability-listing' | 'file-table';
  summary: {
    added: number;
    removed: number;
    capCountMismatches: number;
    contextMissing: number;
    contextStale: number;
    contextContentDrift: number;
    tableLayoutDirty: boolean;
  };
  contextMissing: Array<{ dir: string; file: string }>;
  contextStale: Array<{ dir: string; file: string }>;
  contentDrift: Array<ContextContentDrift & { file: string }>;
  resolution: Array<Record<string, unknown>>;
  capCountMismatches?: Array<{ mismatch: string }>;
  added?: Array<{ dir?: string; file?: string; module?: ModuleInfo }>;
  removed?: Array<{ file: string }>;
  tableLayout?: TableLayoutVerdict;
  agentsMd?: { file: string; exists: boolean; stale: boolean };
}

/** CAPABILITIES 段：listing 计数不一致 / file-table 条目增删（含 resolution 指引） */
function applyCapsSections(
  report: SyncJsonReport,
  state: SyncState,
  verdict: SyncVerdict
): void {
  if (state.capsIsCapabilityListing && verdict.hasCapIssues) {
    report.capCountMismatches = state.capCountMismatches.map(m => ({ mismatch: m }));
    report.resolution.push({
      action: 'sync-capability-counts',
      command: 'harness sync-docs',
      details: 'CAPABILITIES.md 计数与代码不一致，运行 harness sync-docs 自动更新',
    });
  }

  if (!state.capsIsCapabilityListing && verdict.hasTableEntryIssues) {
    if (state.capsMode === 'module') {
      // module 模式：added 为聚合后的未覆盖目录，需人工登记目录条目
      report.added = state.result.added.map(d => ({ dir: d }));
      report.removed = state.result.removed.map(f => ({ file: f }));
      report.resolution.push({
        action: 'register-capability-dirs',
        details:
          '在 CAPABILITIES.md 中为这些目录登记一行目录条目（如 `| 模块名 | src/xxx/ | 说明 |`）',
        dirs: state.result.added,
      });
    } else {
      report.added = state.result.added.map(f => {
        return {
          file: f,
          module: state.currentModules.find(m => path.basename(m.file) === f),
        };
      });
      report.removed = state.result.removed.map(f => ({ file: f }));
      report.resolution.push({
        action: 'sync-capabilities',
        command: 'harness sync-docs',
      });
    }
  }
}

/** 表格排版段：空行切表 / 空表头 */
function applyTableLayoutSection(
  report: SyncJsonReport,
  state: SyncState,
  verdict: SyncVerdict
): void {
  if (verdict.hasTableLayoutIssues) {
    report.tableLayout = {
      blankLines: state.tableLayout.blankLines,
      emptyTables: state.tableLayout.emptyTables,
    };
    report.resolution.push({
      action: 'sync-capabilities-table-layout',
      command: 'harness sync-docs',
      details:
        'CAPABILITIES.md 的表格被空行切断、或残留无数据行的空表头，运行 harness sync-docs 收拢',
    });
  }
}

/** CONTEXT.md 段：缺失 / 内容漂移 / mtime 提示（纯 resolution 指引，不加顶层键） */
function applyContextSection(
  report: SyncJsonReport,
  state: SyncState,
  verdict: SyncVerdict
): void {
  if (verdict.hasContextIssues) {
    report.resolution.push(
      ...(state.result.contextMissing.length > 0
        ? [{ action: 'create-context-md', command: 'harness sync-docs', dirs: state.result.contextMissing }]
        : []),
      ...(state.result.contextContentDrift.length > 0
        ? [{
            action: 'fix-context-content-drift',
            details:
              'CONTEXT.md「核心导出」节与目录导出面不一致：要么按实现改文档，要么在票面记录'
              + '「文档正确、代码待改」；散文不可机械生成，sync-docs 不改写 CONTEXT.md',
            drift: state.result.contextContentDrift,
          }]
        : []),
      ...(state.result.contextStale.length > 0
        ? [{ action: 'update-context-md', command: 'harness sync-docs', dirs: state.result.contextStale }]
        : []),
    );
  }
}

/** AGENTS.md 段：存在性 / 漂移 */
function applyAgentsSection(
  report: SyncJsonReport,
  state: SyncState,
  options: SyncDocsOptions
): void {
  if (options.agents) {
    report.agentsMd = { file: 'AGENTS.md', exists: state.agentsMdExists, stale: state.agentsMdStale };
    if (state.agentsMdStale) {
      report.resolution.push({
        action: 'sync-agents-md',
        command: 'harness sync-docs --agents',
        details: '生成/更新 AGENTS.md（agent 导读）',
      });
    }
  }
}

/**
 * JSON 出口：结构化输出供 LLM 消费；返回是否 hasIssues（退出码由调用方译）
 */
export function emitJsonReport(
  io: CommandIO,
  state: SyncState,
  verdict: SyncVerdict,
  options: SyncDocsOptions
): void {
  const jsonOutput: SyncJsonReport = {
    stale: verdict.hasIssues,
    format: state.capsIsCapabilityListing ? 'capability-listing' : 'file-table',
    summary: {
      added: state.result.added.length,
      removed: state.result.removed.length,
      capCountMismatches: state.capCountMismatches.length,
      contextMissing: state.result.contextMissing.length,
      contextStale: state.result.contextStale.length,
      contextContentDrift: state.result.contextContentDrift.length,
      tableLayoutDirty: verdict.hasTableLayoutIssues,
    },
    contextMissing: state.result.contextMissing.map(d => ({
      dir: d,
      file: `${d}/CONTEXT.md`,
    })),
    contextStale: state.result.contextStale.map(d => ({
      dir: d,
      file: `${d}/CONTEXT.md`,
    })),
    contentDrift: state.result.contextContentDrift.map((d) => ({
      dir: d.dir,
      file: `${d.dir}/CONTEXT.md`,
      ghosts: d.ghosts,
      unlisted: d.unlisted,
      ...(d.constructionSites ? { constructionSites: d.constructionSites } : {}),
    })),
    resolution: [],
  };

  applyCapsSections(jsonOutput, state, verdict);
  applyTableLayoutSection(jsonOutput, state, verdict);
  applyContextSection(jsonOutput, state, verdict);
  applyAgentsSection(jsonOutput, state, options);

  log(io, JSON.stringify(jsonOutput, null, 2));
}

/**
 * 人读出口：逐项问题打印（无判定、无返回）
 */
export function emitHumanReport(
  io: CommandIO,
  state: SyncState,
  verdict: SyncVerdict
): void {
  if (state.capsIsCapabilityListing && verdict.hasCapIssues) {
    log(io, chalk.yellow(`\n📊 CAPABILITIES.md 计数不一致:`));
    state.capCountMismatches.forEach(m => log(io, chalk.gray(`  - ${m}`)));
  }

  if (state.result.added.length > 0) {
    if (state.capsMode === 'module') {
      log(io, chalk.yellow(`\n📄 CAPABILITIES.md 未登记以下模块（目录）:`));
      state.result.added.forEach(d => log(io, chalk.gray(`  + ${d}`)));
      log(io,
        chalk.gray('  请在 CAPABILITIES.md 中为这些目录登记一行目录条目（如 `| 模块名 | src/xxx/ | 说明 |`）')
      );
    } else {
      log(io, chalk.yellow(`\n📄 CAPABILITIES.md 缺少以下模块:`));
      state.result.added.forEach(f => log(io, chalk.gray(`  + ${f}`)));
    }
  }

  if (state.result.removed.length > 0) {
    log(io, chalk.yellow(`\n📄 CAPABILITIES.md 包含已删除的模块:`));
    state.result.removed.forEach(f => log(io, chalk.gray(`  - ${f}`)));
  }

  if (verdict.hasTableLayoutIssues) {
    log(io, chalk.yellow(`\n🧹 CAPABILITIES.md 表格排版待收拢:`));
    if (state.tableLayout.blankLines > 0) {
      log(io, chalk.gray(`  - 表格内空行 ${state.tableLayout.blankLines} 处（CommonMark 会在此把表格切断）`));
    }
    if (state.tableLayout.emptyTables > 0) {
      log(io, chalk.gray(`  - 无数据行的空表 ${state.tableLayout.emptyTables} 张（连表头/分隔行一起收掉）`));
    }
  }

  if (state.result.contextMissing.length > 0) {
    log(io, chalk.yellow(`\n📋 缺少 CONTEXT.md:`));
    state.result.contextMissing.forEach(d => log(io, chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (state.result.contextContentDrift.length > 0) {
    log(io, chalk.yellow(`\n📋 CONTEXT.md 与实现漂移（「核心导出」节 vs 目录导出面）:`));
    state.result.contextContentDrift.forEach((d) => {
      log(io, chalk.gray(`  - ${d.dir}/CONTEXT.md`));
      if (d.ghosts.length > 0) {
        log(io, chalk.gray(`      幽灵符号（文档声明、导出面已无）: ${d.ghosts.join(', ')}`));
      }
      if (d.unlisted.length > 0) {
        log(io, chalk.gray(`      barrel 未登记（公开值符号未进「核心导出」节）: ${d.unlisted.join(', ')}`));
      }
      for (const s of d.constructionSites ?? []) {
        log(io,
          chalk.gray(`      构造点漂移（标记声明 ${s.className} = ${s.expected}，实况 ${s.actual} 处）`)
        );
      }
    });
    log(io, chalk.gray('  散文不可机械生成：按实现改文档，或在票面记录「文档正确、代码待改」'));
  }

  if (state.result.contextStale.length > 0) {
    log(io, chalk.gray(`\n💡 提示：以下 CONTEXT.md 的源码比文档新（仅提示，不判失败）:`));
    state.result.contextStale.forEach(d => log(io, chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (verdict.hasAgentsIssues) {
    log(io,
      chalk.yellow(state.agentsMdExists
        ? `\n🤖 AGENTS.md 与当前项目状态不一致:`
        : `\n🤖 缺少 AGENTS.md（agent 导读）:`)
    );
    log(io, chalk.gray(`  - AGENTS.md`));
  }

  if (state.agentsMdMalformedPreserve.length > 0) {
    log(io,
      chalk.yellow(
        `\n⚠️ AGENTS.md 中 PRESERVE 标记块未闭合（不予保留，重新生成将丢弃）: ${state.agentsMdMalformedPreserve.join(', ')}`
      )
    );
  }
}
