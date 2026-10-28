/**
 * sync-docs 的「采集 → 判定」主入口（ADR-0040 Phase 3 拆段；P2.8 自
 * cli/commands/sync-docs/ 下沉 core/docs-sync/，handoff P2 第 4 项：
 * 文档同步模块负责采集与判定，CLI 只保留输出）
 *
 * - collectSyncState：扫描源码模块 → CAPABILITIES.md 两种格式判定与对比 →
 *   CONTEXT.md 缺失/漂移/mtime → AGENTS.md 期望内容 → 表格排版，全部收成一枚 SyncState；
 * - judgeSyncState：SyncState → 问题旗标组（hasIssues 族）与可定位的漂移 reason。
 * 出口（JSON/人读输出、写入自愈）住 cli/commands/sync-docs/ 的 sync-output.ts /
 * sync-writes.ts；「未找到 srcDir」警告属输出职责，由输出侧从 missingSrcDirs 打印。
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  isCapabilityListingFormat,
  checkCapabilityCounts,
  type CapabilityDefinitionSource,
} from '../constraints/capabilities-parser';
import { reconcileCapabilities } from '../constraints/capabilities-reconcile';
import { reconcileContext } from '../constraints/context-reconcile';
import {
  parseConstructionSiteMarkers,
  reconcileConstructionSites,
} from '../constraints/construction-sites';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { getCapabilitiesMode, type CapabilitiesMode } from '../constraints/governance-accessors';
import { getSourceDirs, scanSourceModules, getRequiredContextDirs } from './project-reader';
import type { ModuleInfo, SyncResult } from './project-reader';
import {
  parseCapabilitiesFiles,
  normalizeCapabilitiesTableLayout,
} from './capabilities-table';
import {
  findExistingContextFiles,
  getLatestTsMtime,
  collectContextExportSurface,
  createConstructionSiteCounter,
  type ConstructionSiteCounter,
} from './context-collector';
import { buildAgentsMd } from './agents-syncer';
import { extractPreserveBlocks, composeAgentsMd } from './preserve-block';

export interface SyncDocsOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 只检查，不写入（CI 模式） */
  check?: boolean;
  /** 输出 JSON 格式（供 LLM 消费） */
  json?: boolean;
  /** 同步 AGENTS.md（agent 导读）；PRESERVE 标记段在重新生成时原样保留 */
  agents?: boolean;
  /** 一次性迁移：将 CAPABILITIES.md 文件表格折叠为目录条目 */
  compact?: boolean;
  /**
   * 门禁模式（harness#189）：照常自愈写入后，判定被管理文档相对 HEAD 是否有
   * diff——有 diff 判 fail 且点名缺登记文件，无 diff 判 ok。语义等价原流水线
   * 内联 `git diff --exit-code` 门；与 --check/--json/--compact 互斥。
   */
  gate?: boolean;
}

/** 表格排版脏行判定结果（listing 格式不判，恒零；只取判定两字段，规范化后正文不入判定态） */
export type TableLayoutVerdict = Pick<ReturnType<typeof normalizeCapabilitiesTableLayout>, 'blankLines' | 'emptyTables'>;

/** 一次主流程运行采集到的全部中间态 */
export interface SyncState {
  projectPath: string;
  capsMode: CapabilitiesMode;
  capabilitiesPath: string;
  capsContent: string;
  capsIsCapabilityListing: boolean;
  existingFiles: string[];
  currentModules: ModuleInfo[];
  capCountMismatches: string[];
  result: SyncResult;
  agentsMdExpected: string | null;
  agentsMdExists: boolean;
  agentsMdStale: boolean;
  agentsMdMalformedPreserve: string[];
  tableLayout: TableLayoutVerdict;
  /**
   * 配置要求但不在场的源码根（采集期跳过）。提示打印是输出职责，
   * 由 cli 侧 sync-output.ts 从本字段打出（stdout 字节序与旧实现一致）。
   */
  missingSrcDirs: string[];
}

/**
 * 采集段：扫描与全部判定面数据收集（不写任何文件、不打印——纯采集+判定）
 */
export async function collectSyncState(
  projectPath: string,
  options: SyncDocsOptions,
  definitions: CapabilityDefinitionSource
): Promise<SyncState> {
  const capsMode = getCapabilitiesMode(projectPath);

  const result: SyncResult = {
    added: [],
    removed: [],
    contextMissing: [],
    contextStale: [],
    contextContentDrift: [],
  };

  // 1. 先判定本次运行需要什么：源码目录列表 + 现有 CAPABILITIES.md 的格式
  //    （格式判定必须在扫描之前——它决定下面那份清单要不要去取）
  const srcDirs = await getSourceDirs(projectPath);
  const capabilitiesPath = path.join(projectPath, 'CAPABILITIES.md');
  let existingFiles: string[] = [];
  let capsContent = '';
  let capsIsCapabilityListing = false;
  // CAPABILITIES.md 不存在 → 将创建（空内容走新文档路径）；存在但读失败 → 抛出
  if (existsSync(capabilitiesPath)) {
    capsContent = await fs.readFile(capabilitiesPath, 'utf-8');
    // mode=listing 是清单格式的显式声明，与嗅探结果等价
    if (capsMode === 'listing' || isCapabilityListingFormat(capsContent)) {
      capsIsCapabilityListing = true;
    } else {
      existingFiles = await parseCapabilitiesFiles(capabilitiesPath);
    }
  }

  // 2. 扫描源码模块（从 governance config 读取目录列表，默认 src/）
  // capability-listing 格式不做条目级比对（计数才是判定面），模块清单在本次运行里无人
  // 消费 → 整树一份 .ts 内容都不读（harness#147；改造前是无条件全树逐文件读首行注释）。
  const currentModules: ModuleInfo[] = [];
  const missingSrcDirs: string[] = [];
  if (!capsIsCapabilityListing) {
    for (const srcDir of srcDirs) {
      // 目录缺失 = 未配置该源码根（采集跳过并记入 state，提示由输出侧打出）；
      // 目录在而扫描失败 = 真故障，抛出
      if (!existsSync(path.join(projectPath, srcDir))) {
        missingSrcDirs.push(srcDir);
        continue;
      }
      const modules = await scanSourceModules(path.join(projectPath, srcDir), projectPath);
      currentModules.push(...modules);
    }
  }

  // 3. 对比差异（分两种格式）
  let capCountMismatches: string[] = [];

  if (capsIsCapabilityListing) {
    // 能力清单格式：委托 FreshnessRunner 对比计数
    const countCheck = checkCapabilityCounts(projectPath, definitions);
    capCountMismatches = countCheck.mismatches;
    // 不填充 result.added/removed（文件级对比不适用于此格式）
  } else {
    // 传统的文件表格格式：覆盖/幽灵判定统一走 capabilities-reconcile（ADR-0009），
    // 与 capability_sync / docs_freshness 检查器共享同一份规则，check 与 fix 口径必然一致
    const verdict = reconcileCapabilities({
      content: capsContent,
      populationFiles: currentModules.map((m) => m.file),
      fileExists: (rel) => existsSync(path.join(projectPath, rel)),
      sourceRoots: detectSourceRoots(projectPath),
    });
    if (capsMode === 'module') {
      // module 模式：added 为聚合后的「未覆盖目录」，需人工登记目录条目
      result.added = verdict.uncoveredDirs;
    } else {
      result.added = verdict.uncoveredFiles.map((f) => path.basename(f));
    }
    // removed：文件与目录条目一起查（幽灵目录行若不清除，docs_freshness 从严后
    // check 会持续报失败而 fix 修不掉——check/fix 必须同规则才能收敛）
    result.removed = verdict.deadEntries;
  }

  // 4. 检查 CONTEXT.md（缺失 + 内容漂移 + mtime 提示）
  // CI 标志：CI runner 上是全新 checkout，mtime 由 clone 顺序决定（同目录 CONTEXT.md 排序
  // 恒先于 .ts），比出来的「过时」是假灯（harness#142 实测证据）→ 连提示都不给。
  const isCi = Boolean(process.env.CI) && process.env.CI !== 'false';

  // 4a. 配置中要求的目录：检查缺失
  const contextDirs = await getRequiredContextDirs(projectPath);
  for (const dir of contextDirs) {
    const contextPath = path.join(projectPath, dir, 'CONTEXT.md');
    if (!existsSync(contextPath)) {
      result.contextMissing.push(dir);
    }
  }

  // 4b. 自动发现已有的 CONTEXT.md：内容判定（漂移 = 判定面）+ mtime（仅本地提示）
  // 构造点计数器懒建（harness#202）：全仓走一遍不便宜，只在某份文档真带
  // construction-sites 标记时才采集，一次运行内按口径 memo 共用。
  let constructionCounter: ConstructionSiteCounter | null = null;
  const existingContextFiles = await findExistingContextFiles(projectPath, srcDirs);
  for (const dir of existingContextFiles) {
    const contextPath = path.join(projectPath, dir, 'CONTEXT.md');
    // fail-fast：dir 来自 findExistingContextFiles 的实况扫描，读/判定失败是真故障，
    // 抛出不跳过——静默跳过会让漂移判定漏报
    const contextMd = await fs.readFile(contextPath, 'utf-8');
    const { surface, barrelExports } = await collectContextExportSurface(
      path.join(projectPath, dir),
      projectPath
    );
    const verdict = reconcileContext({
      contextMdContent: contextMd,
      exportSurface: surface,
      barrelExports,
    });
    // 构造点计数标记（ADR-0039）：无标记的散文维持现状不判
    const markers = parseConstructionSiteMarkers(contextMd);
    const siteDrift = markers.length > 0
      ? reconcileConstructionSites({
          markers,
          countFor: (constructionCounter ??= createConstructionSiteCounter(projectPath)),
        }).drift
      : [];
    if (
      verdict.ghosts.length > 0 ||
      verdict.unlistedBarrelExports.length > 0 ||
      siteDrift.length > 0
    ) {
      result.contextContentDrift.push({
        dir,
        ghosts: verdict.ghosts,
        unlisted: verdict.unlistedBarrelExports,
        ...(siteDrift.length > 0 ? { constructionSites: siteDrift } : {}),
      });
    }

    if (!isCi) {
      const contextStat = await fs.stat(contextPath);
      const latestTsMtime = await getLatestTsMtime(path.join(projectPath, dir));
      if (latestTsMtime && latestTsMtime > contextStat.mtimeMs) {
        result.contextStale.push(dir);
      }
    }
  }

  // 4c. AGENTS.md（--agents 启用）：缺失或内容漂移
  // 漂移比对基于"生成内容 + 既有 PRESERVE 标记块"的组合结果：
  // PRESERVE 块原样穿过，块内手改不报漂移；块外手改/仓库状态变化报漂移。
  let agentsMdExpected: string | null = null;
  let agentsMdExists = false;
  let agentsMdStale = false;
  let agentsMdMalformedPreserve: string[] = [];
  if (options.agents) {
    const generated = await buildAgentsMd(projectPath, srcDirs);
    // 缺失视为漂移；存在但读失败 → 抛出（fail-fast）
    const agentsMdPath = path.join(projectPath, 'AGENTS.md');
    const existing = existsSync(agentsMdPath)
      ? await fs.readFile(agentsMdPath, 'utf-8')
      : null;
    agentsMdExists = existing !== null;
    const { blocks, malformed } = existing !== null
      ? extractPreserveBlocks(existing)
      : { blocks: [] as string[], malformed: [] as string[] };
    agentsMdMalformedPreserve = malformed;
    agentsMdExpected = composeAgentsMd(generated, blocks);
    agentsMdStale = existing !== agentsMdExpected;
  }

  // 表格排版脏行（#171）：撤登记时残留的空行会把 CAPABILITIES.md 的表格切断。
  // 判定与修复共用 normalizeCapabilitiesTableLayout 正本——同一份规则，check 报的 fix 必清得掉。
  const tableLayout: TableLayoutVerdict = capsIsCapabilityListing
    ? { blankLines: 0, emptyTables: 0 }
    : normalizeCapabilitiesTableLayout(capsContent);

  return {
    projectPath,
    capsMode,
    capabilitiesPath,
    capsContent,
    capsIsCapabilityListing,
    existingFiles,
    currentModules,
    capCountMismatches,
    result,
    agentsMdExpected,
    agentsMdExists,
    agentsMdStale,
    agentsMdMalformedPreserve,
    tableLayout,
    missingSrcDirs,
  };
}

/** 判定段产物：问题旗标组 + 可定位的 CONTEXT.md 漂移 reason */
export interface SyncVerdict {
  hasTableLayoutIssues: boolean;
  hasTableEntryIssues: boolean;
  hasTableIssues: boolean;
  hasCapIssues: boolean;
  hasContextIssues: boolean;
  hasAgentsIssues: boolean;
  hasIssues: boolean;
  contextDriftReason: string;
}

/**
 * 判定段：采集态 → 问题旗标（无任何 IO）
 */
export function judgeSyncState(state: SyncState, options: SyncDocsOptions): SyncVerdict {
  const hasTableLayoutIssues = state.tableLayout.blankLines > 0 || state.tableLayout.emptyTables > 0;
  const hasTableEntryIssues = state.result.added.length > 0 || state.result.removed.length > 0;
  const hasTableIssues = hasTableEntryIssues || hasTableLayoutIssues;
  const hasCapIssues = state.capCountMismatches.length > 0;
  // mtime 只作提示，不参与判定（harness#142）：判定面是内容漂移与缺失
  const hasContextIssues = state.result.contextMissing.length > 0 || state.result.contextContentDrift.length > 0;
  const hasAgentsIssues = options.agents === true && state.agentsMdStale;
  const hasIssues = hasTableIssues || hasCapIssues || hasContextIssues || hasAgentsIssues;
  const contextDriftReason = state.result.contextContentDrift
    .map((d) => {
      const sites = (d.constructionSites ?? [])
        .map((s) => `${s.className} 期望 ${s.expected} 实际 ${s.actual}`)
        .join(', ');
      return (
        `${d.dir}/CONTEXT.md（幽灵符号: ${d.ghosts.join(', ') || '无'}；` +
        `barrel 未登记: ${d.unlisted.join(', ') || '无'}` +
        (sites ? `；构造点漂移: ${sites}` : '') +
        '）'
      );
    })
    .join('、');

  return {
    hasTableLayoutIssues,
    hasTableEntryIssues,
    hasTableIssues,
    hasCapIssues,
    hasContextIssues,
    hasAgentsIssues,
    hasIssues,
    contextDriftReason,
  };
}
