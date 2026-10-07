/**
 * sync-docs 主流程（Phase 3 自 index.ts 拆出，纯移位）
 *
 * 默认形态：扫描源码模块 → CAPABILITIES.md 两种格式判定 → CONTEXT.md 缺失/漂移
 * → AGENTS.md（--agents）→ json/人读报告 → 写入模式自愈。--gate 的收尾判定经
 * `gate.ts` 的 runHeadGateVerdict；--compact 形态不经过本文件（见 compact.ts）。
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import {
  isCapabilityListingFormat,
  checkCapabilityCounts,
  updateCapabilityCounts,
  type CapabilityDefinitionSource,
} from '../../../core/constraints/capabilities-parser';
import { COMMAND_DEFINITIONS } from '../definitions';
import { GATE_DEFINITIONS } from '../../../gates/definitions';
import { reconcileCapabilities } from '../../../core/constraints/capabilities-reconcile';
import { reconcileContext } from '../../../core/constraints/context-reconcile';
import {
  parseConstructionSiteMarkers,
  reconcileConstructionSites,
} from '../../../core/constraints/construction-sites';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { getCapabilitiesMode } from '../../../core/project-config-loader';
import { getSourceDirs, scanSourceModules, getRequiredContextDirs } from './project-reader';
import type { ModuleInfo, SyncResult } from './project-reader';
import {
  parseCapabilitiesFiles,
  updateCapabilitiesFile,
  normalizeCapabilitiesTableLayout,
} from './capabilities-syncer';
import {
  createContextMd,
  findExistingContextFiles,
  getLatestTsMtime,
  collectContextExportSurface,
  createConstructionSiteCounter,
  type ConstructionSiteCounter,
} from './context-syncer';
import { buildAgentsMd } from './agents-syncer';
import { extractPreserveBlocks, composeAgentsMd } from './preserve-block';
import { runHeadGateVerdict } from './gate';
import { log, processIO, type CommandIO, type CommandResult } from '../../command-contract';

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

/**
 * 能力清单计数源（harness#88）
 *
 * core 的 capabilities-parser 不再值导入定义表（单向分层），命令/门禁计数由
 * cli 侧在此组装后注入；两张表都是纯数据模块（ADR-0002 命令形状单一来源）。
 */
const CAPABILITY_DEFINITIONS: CapabilityDefinitionSource = {
  commands: COMMAND_DEFINITIONS,
  gates: GATE_DEFINITIONS,
};

/**
 * 漂移译成 kind：--check 下判定失败；写入模式下漂移已被修掉 → 退出码面不变（历史行为）
 */
export function driftOutcome(isCheck: boolean): (reason: string) => CommandResult {
  return (reason: string): CommandResult => (isCheck ? { kind: 'fail', reason } : { kind: 'ok' });
}

/**
 * 同步文档主流程（--gate / --compact 之外的默认形态；--gate 复用本流程后接 gate 判定）
 */
export async function runMainSyncFlow(
  options: SyncDocsOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  const projectPath = options.projectPath || process.cwd();
  const isCheck = options.check === true;
  const drift = driftOutcome(isCheck);
  const isJson = options.json === true;
  const capsMode = getCapabilitiesMode(projectPath);

  if (!isJson) {
    if (isCheck) {
      log(io, chalk.blue('🔍 检查文档新鲜度...'));
    } else {
      log(io, chalk.blue('📝 同步文档...'));
    }
  }

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
  if (!capsIsCapabilityListing) {
    for (const srcDir of srcDirs) {
      // 目录缺失 = 未配置该源码根（可见跳过）；目录在而扫描失败 = 真故障，抛出
      if (!existsSync(path.join(projectPath, srcDir))) {
        if (!isJson) {
          log(io, chalk.yellow(`⚠️  未找到 ${srcDir} 目录，跳过`));
        }
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
    const countCheck = checkCapabilityCounts(projectPath, CAPABILITY_DEFINITIONS);
    capCountMismatches = countCheck.mismatches;
    // 不填充 result.added/removed（文件级对比不适用于此格式）
  } else {
    // 传统的文件表格格式：覆盖/幽灵判定统一走 capabilities-reconcile（ADR-0009），
    // 与 capability_sync / docs_freshness 检查器共享同一份规则，check 与 fix 口径必然一致
    const getBasename = (f: string) => {
      const clean = f.endsWith('/') ? f.slice(0, -1) : f;
      // split('/') 恒产出 ≥1 段，末段索引恒有值
      const segments = clean.split('/');
      return segments[segments.length - 1];
    };
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
      result.added = verdict.uncoveredFiles.map((f) => getBasename(f));
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
  const hasAgentsIssues = options.agents === true && agentsMdStale;

  // 表格排版脏行（#171）：撤登记时残留的空行会把 CAPABILITIES.md 的表格切断。
  // 判定与修复共用 normalizeCapabilitiesTableLayout 正本——同一份规则，check 报的 fix 必清得掉。
  const tableLayout = capsIsCapabilityListing
    ? { blankLines: 0, emptyTables: 0 }
    : normalizeCapabilitiesTableLayout(capsContent);
  const hasTableLayoutIssues = tableLayout.blankLines > 0 || tableLayout.emptyTables > 0;

  const hasTableEntryIssues = result.added.length > 0 || result.removed.length > 0;
  const hasTableIssues = hasTableEntryIssues || hasTableLayoutIssues;
  const hasCapIssues = capCountMismatches.length > 0;
  // mtime 只作提示，不参与判定（harness#142）：判定面是内容漂移与缺失
  const hasContextIssues = result.contextMissing.length > 0 || result.contextContentDrift.length > 0;
  const hasIssues = hasTableIssues || hasCapIssues || hasContextIssues || hasAgentsIssues;
  const contextDriftReason = result.contextContentDrift
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

  // 5. JSON 输出模式：结构化输出供 LLM 消费
  if (isJson) {
    const jsonOutput: Record<string, unknown> = {
      stale: hasIssues,
      format: capsIsCapabilityListing ? 'capability-listing' : 'file-table',
      summary: {
        added: result.added.length,
        removed: result.removed.length,
        capCountMismatches: capCountMismatches.length,
        contextMissing: result.contextMissing.length,
        contextStale: result.contextStale.length,
        contextContentDrift: result.contextContentDrift.length,
        tableLayoutDirty: hasTableLayoutIssues,
      },
      contextMissing: result.contextMissing.map(d => ({
        dir: d,
        file: `${d}/CONTEXT.md`,
      })),
      contextStale: result.contextStale.map(d => ({
        dir: d,
        file: `${d}/CONTEXT.md`,
      })),
      contentDrift: result.contextContentDrift.map((d) => ({
        dir: d.dir,
        file: `${d.dir}/CONTEXT.md`,
        ghosts: d.ghosts,
        unlisted: d.unlisted,
        ...(d.constructionSites ? { constructionSites: d.constructionSites } : {}),
      })),
      resolution: [] as Array<Record<string, unknown>>,
    };

    if (capsIsCapabilityListing && hasCapIssues) {
      jsonOutput.capCountMismatches = capCountMismatches.map(m => ({ mismatch: m }));
      (jsonOutput.resolution as Array<Record<string, unknown>>).push({
        action: 'sync-capability-counts',
        command: 'harness sync-docs',
        details: 'CAPABILITIES.md 计数与代码不一致，运行 harness sync-docs 自动更新',
      });
    }

    if (!capsIsCapabilityListing && hasTableEntryIssues) {
      if (capsMode === 'module') {
        // module 模式：added 为聚合后的未覆盖目录，需人工登记目录条目
        jsonOutput.added = result.added.map(d => ({ dir: d }));
        jsonOutput.removed = result.removed.map(f => ({ file: f }));
        (jsonOutput.resolution as Array<Record<string, unknown>>).push({
          action: 'register-capability-dirs',
          details:
            '在 CAPABILITIES.md 中为这些目录登记一行目录条目（如 `| 模块名 | src/xxx/ | 说明 |`）',
          dirs: result.added,
        });
      } else {
        jsonOutput.added = result.added.map(f => {
          const getBasenameLocal = (s: string) => {
            const segments = s.split('/');
            return segments[segments.length - 1];
          };
          return {
            file: f,
            module: currentModules.find(m => getBasenameLocal(m.file) === f),
          };
        });
        jsonOutput.removed = result.removed.map(f => ({ file: f }));
        (jsonOutput.resolution as Array<Record<string, unknown>>).push({
          action: 'sync-capabilities',
          command: 'harness sync-docs',
        });
      }
    }

    if (hasTableLayoutIssues) {
      jsonOutput.tableLayout = {
        blankLines: tableLayout.blankLines,
        emptyTables: tableLayout.emptyTables,
      };
      (jsonOutput.resolution as Array<Record<string, unknown>>).push({
        action: 'sync-capabilities-table-layout',
        command: 'harness sync-docs',
        details:
          'CAPABILITIES.md 的表格被空行切断、或残留无数据行的空表头，运行 harness sync-docs 收拢',
      });
    }

    if (hasContextIssues) {
      (jsonOutput.resolution as Array<Record<string, unknown>>).push(
        ...(result.contextMissing.length > 0
          ? [{ action: 'create-context-md', command: 'harness sync-docs', dirs: result.contextMissing }]
          : []),
        ...(result.contextContentDrift.length > 0
          ? [{
              action: 'fix-context-content-drift',
              details:
                'CONTEXT.md「核心导出」节与目录导出面不一致：要么按实现改文档，要么在票面记录'
                + '「文档正确、代码待改」；散文不可机械生成，sync-docs 不改写 CONTEXT.md',
              drift: result.contextContentDrift,
            }]
          : []),
        ...(result.contextStale.length > 0
          ? [{ action: 'update-context-md', command: 'harness sync-docs', dirs: result.contextStale }]
          : []),
      );
    }

    if (options.agents) {
      jsonOutput.agentsMd = { file: 'AGENTS.md', exists: agentsMdExists, stale: agentsMdStale };
      if (agentsMdStale) {
        (jsonOutput.resolution as Array<Record<string, unknown>>).push({
          action: 'sync-agents-md',
          command: 'harness sync-docs --agents',
          details: '生成/更新 AGENTS.md（agent 导读）',
        });
      }
    }

    log(io, JSON.stringify(jsonOutput, null, 2));
    return hasIssues ? drift('文档不是最新的（详见 --json 输出 issues 字段）') : { kind: 'ok' };
  }

  // 6. 人读输出模式
  if (capsIsCapabilityListing && hasCapIssues) {
    log(io, chalk.yellow(`\n📊 CAPABILITIES.md 计数不一致:`));
    capCountMismatches.forEach(m => log(io, chalk.gray(`  - ${m}`)));
  }

  if (result.added.length > 0) {
    if (capsMode === 'module') {
      log(io, chalk.yellow(`\n📄 CAPABILITIES.md 未登记以下模块（目录）:`));
      result.added.forEach(d => log(io, chalk.gray(`  + ${d}`)));
      log(io,
        chalk.gray('  请在 CAPABILITIES.md 中为这些目录登记一行目录条目（如 `| 模块名 | src/xxx/ | 说明 |`）')
      );
    } else {
      log(io, chalk.yellow(`\n📄 CAPABILITIES.md 缺少以下模块:`));
      result.added.forEach(f => log(io, chalk.gray(`  + ${f}`)));
    }
  }

  if (result.removed.length > 0) {
    log(io, chalk.yellow(`\n📄 CAPABILITIES.md 包含已删除的模块:`));
    result.removed.forEach(f => log(io, chalk.gray(`  - ${f}`)));
  }

  if (hasTableLayoutIssues) {
    log(io, chalk.yellow(`\n🧹 CAPABILITIES.md 表格排版待收拢:`));
    if (tableLayout.blankLines > 0) {
      log(io, chalk.gray(`  - 表格内空行 ${tableLayout.blankLines} 处（CommonMark 会在此把表格切断）`));
    }
    if (tableLayout.emptyTables > 0) {
      log(io, chalk.gray(`  - 无数据行的空表 ${tableLayout.emptyTables} 张（连表头/分隔行一起收掉）`));
    }
  }

  if (result.contextMissing.length > 0) {
    log(io, chalk.yellow(`\n📋 缺少 CONTEXT.md:`));
    result.contextMissing.forEach(d => log(io, chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (result.contextContentDrift.length > 0) {
    log(io, chalk.yellow(`\n📋 CONTEXT.md 与实现漂移（「核心导出」节 vs 目录导出面）:`));
    result.contextContentDrift.forEach((d) => {
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

  if (result.contextStale.length > 0) {
    log(io, chalk.gray(`\n💡 提示：以下 CONTEXT.md 的源码比文档新（仅提示，不判失败）:`));
    result.contextStale.forEach(d => log(io, chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (hasAgentsIssues) {
    log(io,
      chalk.yellow(agentsMdExists
        ? `\n🤖 AGENTS.md 与当前项目状态不一致:`
        : `\n🤖 缺少 AGENTS.md（agent 导读）:`)
    );
    log(io, chalk.gray(`  - AGENTS.md`));
  }

  if (agentsMdMalformedPreserve.length > 0) {
    log(io,
      chalk.yellow(
        `\n⚠️ AGENTS.md 中 PRESERVE 标记块未闭合（不予保留，重新生成将丢弃）: ${agentsMdMalformedPreserve.join(', ')}`
      )
    );
  }

  // --gate 时无「无需写入即返回」捷径：sync-docs 查不出的未提交手改也是 vs HEAD 漂移，
  // 必须落到末尾的 gate 判定（票面契约：有 diff 即 fail，不问 diff 来源）。
  if (!hasIssues && !options.gate) {
    log(io, chalk.green('✅ 所有文档都是最新的'));
    return { kind: 'ok' };
  }

  // 7. 检查模式：只报告，不修改
  if (isCheck) {
    log(io, chalk.red('\n❌ 文档不是最新的，请运行 harness sync-docs 更新'));
    // reason 必须可定位（harness#142）：CI 判红时要直接拿到文件与符号，不靠翻 stdout
    const tableLayoutReason = hasTableLayoutIssues
      ? `；CAPABILITIES.md 表格排版待收拢（表格内空行 ${tableLayout.blankLines} 处、`
        + `空表 ${tableLayout.emptyTables} 张）`
      : '';
    return drift(
      contextDriftReason
        ? `文档不是最新的（CONTEXT.md 与实现漂移：${contextDriftReason}）${tableLayoutReason}`
        : `文档不是最新的，请运行 harness sync-docs 更新${tableLayoutReason}`
    );
  }

  // 8. 写入模式：更新文档
  if (capsIsCapabilityListing && hasCapIssues) {
    capsContent = updateCapabilityCounts(capsContent, CAPABILITY_DEFINITIONS);
    await fs.writeFile(capabilitiesPath, capsContent, 'utf-8');
    log(io, chalk.green(`\n✅ 已更新 CAPABILITIES.md 计数`));
  }

  if (!capsIsCapabilityListing && hasTableIssues) {
    await updateCapabilitiesFile(capabilitiesPath, currentModules, existingFiles, result, capsMode);
    log(io, chalk.green(`\n✅ 已更新 CAPABILITIES.md`));
  }

  for (const dir of result.contextMissing) {
    await createContextMd(projectPath, dir, io);
  }

  if (hasAgentsIssues && agentsMdExpected !== null) {
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), agentsMdExpected, 'utf-8');
    log(io, chalk.green(agentsMdExists ? `✅ 已更新 AGENTS.md` : `✅ 已生成 AGENTS.md`));
  }

  // --gate（harness#189）：写入完成后判定被管理文档相对 HEAD 的漂移（判定尾部住 gate.ts）
  if (options.gate) {
    return runHeadGateVerdict(projectPath, options, result.contextMissing, io);
  }

  return hasIssues ? drift('写入模式已修复漂移（历史面：退出码仍为 0）') : { kind: 'ok' };
}
