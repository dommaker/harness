/**
 * harness sync-docs 命令（入口编排，工单 22）
 *
 * 自动同步项目文档：CAPABILITIES.md、CONTEXT.md 检查、CHANGELOG 辅助
 * --check 模式输出结构化信息，供 LLM 或 CI 消费
 *
 * 实现拆分：
 * - project-reader.ts       项目信息读取（package.json/config.yml/源码扫描）
 * - capabilities-syncer.ts  CAPABILITIES.md 两种格式的对比与维护
 * - context-syncer.ts       CONTEXT.md 模板生成/发现/过时判定
 * - agents-syncer.ts        AGENTS.md 生成
 * - preserve-block.ts       PRESERVE 标记块提取与组合
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { aggregateToSourceSubdir, readCapabilitiesEntries } from '../../../core/constraints/capabilities-parser';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { getCapabilitiesMode } from '../../../core/project-config-loader';
import { getSourceDirs, scanSourceModules, getRequiredContextDirs } from './project-reader';
import type { ModuleInfo, SyncResult } from './project-reader';
import {
  parseCapabilitiesFiles,
  isCapabilityListingFormat,
  checkCapabilityCounts,
  updateCapabilityCounts,
  updateCapabilitiesFile,
  compactCapabilitiesContent,
} from './capabilities-syncer';
import { createContextMd, findExistingContextFiles, getLatestTsMtime } from './context-syncer';
import { buildAgentsMd } from './agents-syncer';
import { extractPreserveBlocks, composeAgentsMd } from './preserve-block';

export interface SyncDocsOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 只检查，不写入（CI 模式） */
  check?: boolean;
  /** 是否生成 CHANGELOG 条目 */
  changelog?: boolean;
  /** 输出 JSON 格式（供 LLM 消费） */
  json?: boolean;
  /** 同步 AGENTS.md（agent 导读）；PRESERVE 标记段在重新生成时原样保留 */
  agents?: boolean;
  /** 一次性迁移：将 CAPABILITIES.md 文件表格折叠为目录条目 */
  compact?: boolean;
}

/**
 * 同步文档
 */
export async function syncDocs(options: SyncDocsOptions): Promise<boolean> {
  const projectPath = options.projectPath || process.cwd();
  const isCheck = options.check === true;
  const isJson = options.json === true;
  const capsMode = getCapabilitiesMode(projectPath);

  // --compact：一次性迁移，将文件表格折叠为目录条目后直接返回
  if (options.compact) {
    const capsPath = path.join(projectPath, 'CAPABILITIES.md');
    try {
      const content = await fs.readFile(capsPath, 'utf-8');
      const compacted = compactCapabilitiesContent(content);
      if (compacted !== content) {
        await fs.writeFile(capsPath, compacted, 'utf-8');
        if (!isJson) console.log(chalk.green('✅ 已将 CAPABILITIES.md 文件表格折叠为目录条目'));
      } else {
        if (!isJson) console.log(chalk.green('✅ CAPABILITIES.md 无需折叠'));
      }
      return true;
    } catch {
      if (!isJson) console.log(chalk.red('❌ CAPABILITIES.md 不存在，无法折叠'));
      return false;
    }
  }

  if (!isJson) {
    if (isCheck) {
      console.log(chalk.blue('🔍 检查文档新鲜度...'));
    } else {
      console.log(chalk.blue('📝 同步文档...'));
    }
  }

  const result: SyncResult = {
    added: [],
    removed: [],
    contextMissing: [],
    contextStale: [],
  };

  // 1. 扫描源码模块（从 governance config 读取目录列表，默认 src/）
  const srcDirs = await getSourceDirs(projectPath);
  let currentModules: ModuleInfo[] = [];
  for (const srcDir of srcDirs) {
    try {
      const modules = await scanSourceModules(path.join(projectPath, srcDir), projectPath);
      currentModules.push(...modules);
    } catch {
      if (!isJson) {
        console.log(chalk.yellow(`⚠️  未找到 ${srcDir} 目录，跳过`));
      }
    }
  }

  // 2. 解析现有 CAPABILITIES.md，检测格式
  const capabilitiesPath = path.join(projectPath, 'CAPABILITIES.md');
  let existingFiles: string[] = [];
  let capsContent = '';
  let capsIsCapabilityListing = false;
  try {
    capsContent = await fs.readFile(capabilitiesPath, 'utf-8');
    // mode=listing 是清单格式的显式声明，与嗅探结果等价
    if (capsMode === 'listing' || isCapabilityListingFormat(capsContent)) {
      capsIsCapabilityListing = true;
    } else {
      existingFiles = await parseCapabilitiesFiles(capabilitiesPath);
    }
  } catch {
    // CAPABILITIES.md 不存在，将创建
  }

  // 3. 对比差异（分两种格式）
  let capCountMismatches: string[] = [];

  if (capsIsCapabilityListing) {
    // 能力清单格式：委托 FreshnessRunner 对比计数
    const countCheck = checkCapabilityCounts(projectPath);
    capCountMismatches = countCheck.mismatches;
    // 不填充 result.added/removed（文件级对比不适用于此格式）
  } else {
    // 传统的文件表格格式
    const getBasename = (f: string) => {
      const clean = f.endsWith('/') ? f.slice(0, -1) : f;
      return clean.split('/').pop()!;
    };
    const currentBasenames = currentModules.map(m => getBasename(m.file));
    // 目录条目（如 src/、agents/）按前缀覆盖其中的文件，且不参与 removed 对比
    // （basename 列表里永远不会有目录，直接对比会把目录行误报为「已删除的模块」）
    const existingDirs = existingFiles.filter(f => f.endsWith('/'));
    const existingFileNames = existingFiles.filter(f => !f.endsWith('/'));
    if (capsMode === 'module') {
      // module 模式：文件条目精确匹配或目录条目前缀覆盖；
      // added 不再是逐文件列表，聚合为「未覆盖目录」（与 capability_sync checker 同规则）
      const entries = readCapabilitiesEntries(capabilitiesPath, { includeDirs: true });
      const fileEntries = entries.filter(e => !e.endsWith('/'));
      const dirEntries = entries.filter(e => e.endsWith('/'));
      const uncoveredDirs = new Set<string>();
      for (const m of currentModules) {
        const covered =
          fileEntries.includes(m.file) || dirEntries.some(d => m.file.startsWith(d));
        if (!covered) {
          const root = srcDirs.find(d => m.file.startsWith(d + '/')) || srcDirs[0] || '';
          uncoveredDirs.add(aggregateToSourceSubdir(root, m.file));
        }
      }
      result.added = [...uncoveredDirs];
    } else {
      result.added = currentModules
        .filter(
          m =>
            !existingDirs.some(d => m.file.startsWith(d)) &&
            !existingFileNames.includes(getBasename(m.file))
        )
        .map(m => getBasename(m.file));
    }
    result.removed = existingFileNames.filter(f => !currentBasenames.includes(f));

    // 幽灵条目清扫（2026-08-08 studio CI 4 连红事故）：上方按 basename 对比，
    // 同名碰撞时幽灵不可见（如 agent-configs/routes.ts 已删但 agents/routes.ts 仍存在，
    // basename routes.ts 仍在扫描结果中，永远不会被判 removed）。
    // 这里按完整路径直接判存在性（与 docs_freshness 检查器同语义：项目根 + 源码根前缀）。
    const sourceRoots = detectSourceRoots(projectPath);
    const entryExists = (entry: string): boolean =>
      existsSync(path.join(projectPath, entry)) ||
      sourceRoots.some(root => existsSync(path.join(projectPath, root, entry)));
    for (const entry of readCapabilitiesEntries(capabilitiesPath)) {
      // 纯文件名条目（无路径）无法用存在性判定，交由上方 basename 对比
      if (!entry.includes('/') || entryExists(entry)) continue;
      const basename = entry.split('/').pop()!;
      // basename 对比已覆盖（无碰撞场景）时不重复加入
      if (!result.removed.includes(basename) && !result.removed.includes(entry)) {
        result.removed.push(entry);
      }
    }
  }

  // 4. 检查 CONTEXT.md（缺失 + 过时）
  // 4a. 配置中要求的目录：检查缺失
  const contextDirs = await getRequiredContextDirs(projectPath);
  for (const dir of contextDirs) {
    const contextPath = path.join(projectPath, dir, 'CONTEXT.md');
    try {
      await fs.access(contextPath);
    } catch {
      result.contextMissing.push(dir);
    }
  }

  // 4b. 自动发现已有的 CONTEXT.md：检查过时
  const existingContextFiles = await findExistingContextFiles(projectPath, srcDirs);
  for (const dir of existingContextFiles) {
    const contextPath = path.join(projectPath, dir, 'CONTEXT.md');
    try {
      const contextStat = await fs.stat(contextPath);
      const dirPath = path.join(projectPath, dir);
      const latestTsMtime = await getLatestTsMtime(dirPath);
      if (latestTsMtime && latestTsMtime > contextStat.mtimeMs) {
        result.contextStale.push(dir);
      }
    } catch {
      // 目录不存在或无法访问，跳过
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
    let existing: string | null = null;
    try {
      existing = await fs.readFile(path.join(projectPath, 'AGENTS.md'), 'utf-8');
      agentsMdExists = true;
    } catch {
      // 缺失视为漂移
    }
    const { blocks, malformed } = existing !== null
      ? extractPreserveBlocks(existing)
      : { blocks: [] as string[], malformed: [] as string[] };
    agentsMdMalformedPreserve = malformed;
    agentsMdExpected = composeAgentsMd(generated, blocks);
    agentsMdStale = existing !== agentsMdExpected;
  }
  const hasAgentsIssues = options.agents === true && agentsMdStale;

  const hasTableIssues = result.added.length > 0 || result.removed.length > 0;
  const hasCapIssues = capCountMismatches.length > 0;
  const hasContextIssues = result.contextMissing.length > 0 || result.contextStale.length > 0;
  const hasIssues = hasTableIssues || hasCapIssues || hasContextIssues || hasAgentsIssues;

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
      },
      contextMissing: result.contextMissing.map(d => ({
        dir: d,
        file: `${d}/CONTEXT.md`,
      })),
      contextStale: result.contextStale.map(d => ({
        dir: d,
        file: `${d}/CONTEXT.md`,
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

    if (!capsIsCapabilityListing && hasTableIssues) {
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
          const getBasenameLocal = (s: string) => s.split('/').pop()!;
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

    if (hasContextIssues) {
      (jsonOutput.resolution as Array<Record<string, unknown>>).push(
        ...(result.contextMissing.length > 0
          ? [{ action: 'create-context-md', command: 'harness sync-docs', dirs: result.contextMissing }]
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

    console.log(JSON.stringify(jsonOutput, null, 2));
    return !hasIssues;
  }

  // 6. 人读输出模式
  if (capsIsCapabilityListing && hasCapIssues) {
    console.log(chalk.yellow(`\n📊 CAPABILITIES.md 计数不一致:`));
    capCountMismatches.forEach(m => console.log(chalk.gray(`  - ${m}`)));
  }

  if (result.added.length > 0) {
    if (capsMode === 'module') {
      console.log(chalk.yellow(`\n📄 CAPABILITIES.md 未登记以下模块（目录）:`));
      result.added.forEach(d => console.log(chalk.gray(`  + ${d}`)));
      console.log(
        chalk.gray('  请在 CAPABILITIES.md 中为这些目录登记一行目录条目（如 `| 模块名 | src/xxx/ | 说明 |`）')
      );
    } else {
      console.log(chalk.yellow(`\n📄 CAPABILITIES.md 缺少以下模块:`));
      result.added.forEach(f => console.log(chalk.gray(`  + ${f}`)));
    }
  }

  if (result.removed.length > 0) {
    console.log(chalk.yellow(`\n📄 CAPABILITIES.md 包含已删除的模块:`));
    result.removed.forEach(f => console.log(chalk.gray(`  - ${f}`)));
  }

  if (result.contextMissing.length > 0) {
    console.log(chalk.yellow(`\n📋 缺少 CONTEXT.md:`));
    result.contextMissing.forEach(d => console.log(chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (result.contextStale.length > 0) {
    console.log(chalk.yellow(`\n📋 CONTEXT.md 可能过时（源码比文档新）:`));
    result.contextStale.forEach(d => console.log(chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (hasAgentsIssues) {
    console.log(
      chalk.yellow(agentsMdExists
        ? `\n🤖 AGENTS.md 与当前项目状态不一致:`
        : `\n🤖 缺少 AGENTS.md（agent 导读）:`)
    );
    console.log(chalk.gray(`  - AGENTS.md`));
  }

  if (agentsMdMalformedPreserve.length > 0) {
    console.log(
      chalk.yellow(
        `\n⚠️ AGENTS.md 中 PRESERVE 标记块未闭合（不予保留，重新生成将丢弃）: ${agentsMdMalformedPreserve.join(', ')}`
      )
    );
  }

  if (!hasIssues) {
    console.log(chalk.green('✅ 所有文档都是最新的'));
    return true;
  }

  // 7. 检查模式：只报告，不修改
  if (isCheck) {
    console.log(chalk.red('\n❌ 文档不是最新的，请运行 harness sync-docs 更新'));
    return false;
  }

  // 8. 写入模式：更新文档
  if (capsIsCapabilityListing && hasCapIssues) {
    capsContent = updateCapabilityCounts(capsContent, projectPath);
    await fs.writeFile(capabilitiesPath, capsContent, 'utf-8');
    console.log(chalk.green(`\n✅ 已更新 CAPABILITIES.md 计数`));
  }

  if (!capsIsCapabilityListing && hasTableIssues) {
    await updateCapabilitiesFile(capabilitiesPath, currentModules, existingFiles, result, capsMode);
    console.log(chalk.green(`\n✅ 已更新 CAPABILITIES.md`));
  }

  for (const dir of result.contextMissing) {
    await createContextMd(projectPath, dir);
    console.log(chalk.green(`✅ 已创建 ${dir}/CONTEXT.md`));
  }

  if (hasAgentsIssues && agentsMdExpected !== null) {
    await fs.writeFile(path.join(projectPath, 'AGENTS.md'), agentsMdExpected, 'utf-8');
    console.log(chalk.green(agentsMdExists ? `✅ 已更新 AGENTS.md` : `✅ 已生成 AGENTS.md`));
  }

  return !hasIssues;
}
