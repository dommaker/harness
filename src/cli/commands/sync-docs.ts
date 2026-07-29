/**
 * harness sync-docs 命令
 *
 * 自动同步项目文档：CAPABILITIES.md、CONTEXT.md 检查、CHANGELOG 辅助
 * --check 模式输出结构化信息，供 LLM 或 CI 消费
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../core/constraints/definitions';
import { FreshnessRunner } from '../../core/constraints/doc-freshness/runner';
import { FreshnessAutoFix } from '../../core/constraints/doc-freshness/auto-fix';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import type { DocFreshnessCheck } from '../../types/project-config';

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
}

interface ModuleInfo {
  name: string;
  file: string;
  description: string;
}

interface SyncResult {
  added: string[];
  removed: string[];
  contextMissing: string[];
  contextStale: string[];
}

/**
 * 同步文档
 */
export async function syncDocs(options: SyncDocsOptions): Promise<boolean> {
  const projectPath = options.projectPath || process.cwd();
  const isCheck = options.check === true;
  const isJson = options.json === true;

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
    if (isCapabilityListingFormat(capsContent)) {
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
    result.added = currentBasenames.filter(f => !existingFiles.includes(f));
    result.removed = existingFiles.filter(f => !currentBasenames.includes(f));
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
    console.log(chalk.yellow(`\n📄 CAPABILITIES.md 缺少以下模块:`));
    result.added.forEach(f => console.log(chalk.gray(`  + ${f}`)));
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
    await updateCapabilitiesFile(capabilitiesPath, currentModules, existingFiles, result);
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

/**
 * 扫描源码目录，提取模块信息
 */
async function scanSourceModules(srcDir: string, projectPath: string): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(srcDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    // 跳过测试目录和非源码目录
    if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;

    const entryPath = path.join(srcDir, entry);
    const stat = await fs.stat(entryPath);

    if (stat.isDirectory()) {
      // 子目录：递归扫描 .ts 文件（不报告目录条目本身）
      const subFiles = await findTsFiles(entryPath);
      for (const f of subFiles) {
        modules.push({
          name: path.basename(f, '.ts'),
          file: path.relative(projectPath, f),
          description: await extractFileDescription(f),
        });
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && entry !== 'index.ts') {
      modules.push({
        name: path.basename(entry, '.ts'),
        file: path.relative(projectPath, entryPath),
        description: await extractFileDescription(entryPath),
      });
    }
  }

  return modules;
}

/**
 * 递归查找 .ts 文件
 */
async function findTsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
    if (entry === 'index.ts') continue; // barrel export
    const entryPath = path.join(dir, entry);
    const stat = await fs.stat(entryPath);
    if (stat.isDirectory()) {
      results.push(...await findTsFiles(entryPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      results.push(entryPath);
    }
  }
  return results;
}

/**
 * 从文件提取描述
 */
async function extractFileDescription(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return extractFirstComment(content) || path.basename(filePath, '.ts');
  } catch {
    return path.basename(filePath, '.ts');
  }
}

/**
 * 提取文件第一行注释
 */
function extractFirstComment(content: string): string | null {
  // 匹配 /** ... */ 或 // ...
  const jsdocMatch = content.match(/\/\*\*\s*\n\s*\*\s*(.+?)\s*\n/);
  if (jsdocMatch) return jsdocMatch[1];

  const lineMatch = content.match(/^\/\/\s*(.+)$/m);
  if (lineMatch) return lineMatch[1];

  return null;
}

/**
 * 解析 CAPABILITIES.md 中的文件路径
 *
 * 提取所有表格行中提到的 .ts/.tsx/.js/.jsx 文件名（不含路径前缀）
 * 用于模糊匹配：只要文档中提到了该文件名就算已记录
 */
async function parseCapabilitiesFiles(capabilitiesPath: string): Promise<string[]> {
  const content = await fs.readFile(capabilitiesPath, 'utf-8');
  const files: string[] = [];
  // 匹配表格行中的文件名（可能带路径前缀）
  const tableRowRegex = /\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/g;
  let match;
  while ((match = tableRowRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    // 提取基础文件名（如 core/constraints/definitions.ts → definitions.ts）
    const basename = raw.split('/').pop()!;
    if (!files.includes(basename)) {
      files.push(basename);
    }
  }
  // 也匹配目录条目（如 agents/、gates/）
  const dirRegex = /\|\s*([^|]+?\/)\s*\|/g;
  while ((match = dirRegex.exec(content)) !== null) {
    const dir = match[1].trim();
    if (!files.includes(dir)) {
      files.push(dir);
    }
  }
  return files;
}

/**
 * 自动发现已有 CONTEXT.md 文件的目录（相对于 projectPath）
 */
async function findExistingContextFiles(projectPath: string, srcDirs: string[]): Promise<string[]> {
  const dirs: string[] = [];

  async function scan(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      const entryPath = path.join(dir, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory()) {
        // 检查该目录是否有 CONTEXT.md
        try {
          await fs.access(path.join(entryPath, 'CONTEXT.md'));
          dirs.push(path.relative(projectPath, entryPath));
        } catch {
          // 没有，继续递归
        }
        await scan(entryPath);
      }
    }
  }

  for (const srcDir of srcDirs) {
    await scan(path.join(projectPath, srcDir));
  }
  return dirs;
}

/**
 * 获取目录下最新 .ts 文件的修改时间
 * 返回 null 如果目录不存在或没有 .ts 文件
 */
async function getLatestTsMtime(dirPath: string): Promise<number | null> {
  let latest: number | null = null;

  async function scan(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      const entryPath = path.join(dir, entry);
      const stat = await fs.stat(entryPath);
      if (stat.isDirectory()) {
        await scan(entryPath);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        if (latest === null || stat.mtimeMs > latest) {
          latest = stat.mtimeMs;
        }
      }
    }
  }

  await scan(dirPath);
  return latest;
}

/**
 * 获取需要 CONTEXT.md 的目录列表
 */
async function getRequiredContextDirs(projectPath: string): Promise<string[]> {
  const configPath = path.join(projectPath, '.harness', 'config.yml');
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = yaml.load(content) as Record<string, unknown>;
    const governance = config.governance as Record<string, unknown> | undefined;
    const contextFiles = governance?.context_files as Record<string, unknown> | undefined;
    if (contextFiles?.enabled) {
      if (Array.isArray(contextFiles.required_dirs) && contextFiles.required_dirs.length > 0) {
        return contextFiles.required_dirs as string[];
      }
      // Fallback: auto-discover from source roots
      return detectSourceRoots(projectPath);
    }
  } catch {
    // 配置不存在或无法解析
  }
  return [];
}

/**
 * 获取源码扫描目录列表
 * 优先从 governance.context_files.required_dirs 读取，默认 ['src']
 */
async function getSourceDirs(projectPath: string): Promise<string[]> {
  const requiredDirs = await getRequiredContextDirs(projectPath);
  if (requiredDirs.length > 0) return requiredDirs;
  return detectSourceRoots(projectPath);
}

/**
 * 更新 CAPABILITIES.md 文件
 */
async function updateCapabilitiesFile(
  capabilitiesPath: string,
  currentModules: ModuleInfo[],
  existingFiles: string[],
  result: SyncResult,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(capabilitiesPath, 'utf-8');
  } catch {
    // 文件不存在，创建新的
    content = generateCapabilitiesContent(currentModules);
    await fs.writeFile(capabilitiesPath, content, 'utf-8');
    return;
  }

  // 如果有表格行，更新表格
  if (existingFiles.length > 0) {
    // 移除已删除文件的行
    for (const removed of result.removed) {
      const escapedFile = removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 第二列存完整路径，basename 只在末尾出现，用 [^|]* 匹配路径前缀
      const rowRegex = new RegExp(`^\\|[^|]*\\|[^|]*\\b${escapedFile}\\s*\\|.*$`, 'gm');
      content = content.replace(rowRegex, '');
    }

    // 添加新文件的行（在最后一个表格行之后）
    if (result.added.length > 0) {
      const getBasenameLocal = (f: string) => f.split('/').pop()!;
      const addedModules = currentModules.filter(m => result.added.includes(getBasenameLocal(m.file)));
      const tableEndRegex = /(^\|[^|]+\|[^|]+\|[^|]+\|\s*$)/gm;
      let lastTableRow = '';
      let match;
      while ((match = tableEndRegex.exec(content)) !== null) {
        lastTableRow = match[0];
      }

      if (lastTableRow) {
        const newRows = addedModules.map(m =>
          `| ${m.name} | ${m.file} | ${m.description} |`
        ).join('\n');
        content = content.replace(lastTableRow, lastTableRow + '\n' + newRows);
      }
    }

    // 清理多余空行
    content = content.replace(/\n{3,}/g, '\n\n');
  } else {
    // 没有表格，追加模块表格
    content += '\n\n' + generateModuleTable(currentModules);
  }

  // 更新最后更新时间
  const now = new Date().toISOString().split('T')[0];
  content = content.replace(
    /最后更新[:：].*/,
    `最后更新: ${now}`
  );

  await fs.writeFile(capabilitiesPath, content, 'utf-8');
}

/**
 * 生成 CAPABILITIES.md 内容
 */
function generateCapabilitiesContent(modules: ModuleInfo[]): string {
  const now = new Date().toISOString().split('T')[0];
  return `# CAPABILITIES.md

> 最后更新: ${now}

---

${generateModuleTable(modules)}
`;
}

/**
 * 生成模块表格
 */
function generateModuleTable(modules: ModuleInfo[]): string {
  if (modules.length === 0) return '';

  const rows = modules.map(m =>
    `| ${m.name} | ${m.file} | ${m.description} |`
  ).join('\n');

  return `| 模块 | 文件 | 说明 |\n|------|------|------|\n${rows}`;
}

/**
 * 创建 CONTEXT.md 模板
 */
async function createContextMd(projectPath: string, dir: string): Promise<void> {
  const contextPath = path.join(projectPath, dir, 'CONTEXT.md');
  const dirName = path.basename(dir);

  const content = `# ${dirName}

> 此文件描述 ${dir} 目录的职责和上下文。
> 请阅读本目录的源代码，然后填写以下各节。
> 如果使用 AI 编码助手，将本文件内容作为 prompt 请求它分析并填写。

## 职责

本目录的核心职责是？

## 核心导出

本目录对外暴露的主要模块/函数：

## 依赖关系

本目录依赖哪些其他模块，谁依赖本目录？

## 注意事项

开发时需要注意的约束或约定：
`;

  await fs.mkdir(path.join(projectPath, dir), { recursive: true });
  await fs.writeFile(contextPath, content, 'utf-8');
}

// ========================================
// 能力清单格式支持 (capability-listing)
// ========================================

/**
 * 检测 CAPABILITIES.md 是否使用能力清单格式（计数行），而非文件表格格式
 */
function isCapabilityListingFormat(content: string): boolean {
  // 能力清单格式特征：包含 "CLI Commands (N)" / "Iron Laws (N)" 等计数行
  return /CLI Commands\s*\(\d+\)/.test(content) ||
    /Iron Laws?\s*\(\d+\)/.test(content) ||
    /Guidelines?\s*\(\d+\)/.test(content);
}

/**
 * 从文件表格格式中提取文件路径
 */
function extractTableFiles(content: string): string[] {
  const files: string[] = [];
  const tableRowRegex = /\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/g;
  let match;
  while ((match = tableRowRegex.exec(content)) !== null) {
    const raw = match[1].trim();
    const basename = raw.split('/').pop()!;
    if (!files.includes(basename)) {
      files.push(basename);
    }
  }
  return files;
}

/**
 * 构建 CAPABILITIES.md 能力清单格式的检查配置
 */
function buildCapabilityChecks(): DocFreshnessCheck[] {
  return [
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'CLI Commands',
      pattern: 'CLI Commands\\s*\\((\\d+)\\)',
      actual: { kind: 'dir_count', path: 'src/cli/commands', extension: '.ts', exclude: ['index.ts'] },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Quality Gates',
      pattern: 'Quality Gates?\\s*\\((\\d+)\\)',
      actual: { kind: 'dir_count', path: 'src/gates', extension: '.ts', exclude: ['index.ts', 'types.ts'] },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Iron Laws',
      pattern: 'Iron Laws?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(IRON_LAWS).length },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Guidelines',
      pattern: 'Guidelines?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(GUIDELINES).length },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Tips',
      pattern: 'Tips?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(TIPS).length },
    },
  ];
}

/**
 * 使用 FreshnessRunner 检查能力清单计数是否与代码一致（--check 模式）
 */
function checkCapabilityCounts(
  projectPath: string
): { match: boolean; mismatches: string[] } {
  const runner = new FreshnessRunner();
  const checks = buildCapabilityChecks();
  const results = runner.runAll({ checks }, projectPath);

  const mismatches: string[] = [];
  for (const r of results) {
    if (!r.pass && r.message) {
      mismatches.push(r.message);
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

/**
 * 更新 CAPABILITIES.md 中的能力清单计数（write 模式）
 *
 * 使用 FreshnessRunner 获取实际计数，然后 regex 替换文档计数行。
 */
function updateCapabilityCounts(content: string, projectPath: string): string {
  const runner = new FreshnessRunner();

  const cliCount = runner.countFromDir('src/cli/commands', '.ts', ['index.ts'], projectPath);
  const gateCount = runner.countFromDir('src/gates', '.ts', ['index.ts', 'types.ts'], projectPath);
  const ironCount = Object.keys(IRON_LAWS).length;
  const guideCount = Object.keys(GUIDELINES).length;
  const tipsCount = Object.keys(TIPS).length;

  const replacements: [RegExp, string][] = [
    [/CLI Commands\s*\(\d+\)/, `CLI Commands (${cliCount})`],
    [/Quality Gates?\s*\(\d+\)/, `Quality Gates (${gateCount})`],
    [/Iron Laws?\s*\(\d+\)/, `Iron Laws (${ironCount})`],
    [/Guidelines?\s*\(\d+\)/, `Guidelines (${guideCount})`],
    [/Tips?\s*\(\d+\)/, `Tips (${tipsCount})`],
  ];

  for (const [regex, replacement] of replacements) {
    if (regex.test(content)) {
      content = content.replace(regex, replacement);
    }
  }

  return content;
}


// ========================================
// AGENTS.md 生成（--agents）
// ========================================

/** 生成 AGENTS.md 目录结构表时跳过的目录（依赖/构建产物/报告等） */
const AGENTS_MD_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage',
  'playwright-report', 'test-results', '.git', '.next', '.turbo',
]);

/** 知名顶层目录的一句话说明 */
const AGENTS_MD_DIR_ROLES: Record<string, string> = {
  docs: '项目文档',
  scripts: '工具脚本',
  tests: '测试',
  test: '测试',
  bin: '可执行入口/脚本',
  templates: '项目模板',
  '.github': 'CI/CD 配置',
  '.harness': 'harness 配置与运行时状态',
};

/** 常用命令候选（按展示顺序），仅列出 package.json 中实际存在的脚本 */
const AGENTS_MD_COMMANDS: Array<[string, string]> = [
  ['dev', '启动开发环境'],
  ['build', '构建'],
  ['test', '运行测试'],
  ['test:e2e', '端到端测试'],
  ['test:unit', '单元测试'],
  ['typecheck', '类型检查'],
  ['lint', '代码检查'],
  ['start', '启动生产服务'],
];

interface PackageJsonLite {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
}

interface GovernanceInfo {
  hasConfig: boolean;
  preset?: string;
  hasClaudeGovernance: boolean;
  ironLaws?: number;
  guidelines?: number;
}

/**
 * 生成 AGENTS.md 内容（agent 导读：项目简介/目录结构/常用命令/约束治理/知识入口）
 *
 * 纯静态提取（零 LLM），确定性输出：同一代码库状态生成同一内容（无时间戳），
 * 因此重跑幂等。既有文件中的 PRESERVE 标记块由 composeAgentsMd 组合回输出，
 * --check 对组合结果做文本对比检测漂移（块内手改不报漂移）。
 */
async function buildAgentsMd(projectPath: string, srcDirs: string[]): Promise<string> {
  const pkg = await readPackageJsonLite(projectPath);
  const [dirs, governance, hasKnowledge, contextDocCount] = await Promise.all([
    getTopLevelDirEntries(projectPath, srcDirs),
    getGovernanceInfo(projectPath),
    hasKnowledgeDir(projectPath),
    countContextDocs(projectPath, srcDirs),
  ]);

  const name = pkg?.name || path.basename(projectPath);
  const description = pkg?.description || await getConfigDescription(projectPath);

  const lines: string[] = [
    '# AGENTS.md',
    '',
    '> 本文件由 `harness sync-docs --agents` 自动生成，请勿手改。`<!-- PRESERVE:名称 -->` 与 `<!-- /PRESERVE:名称 -->` 之间的内容在重新生成时原样保留。内容漂移时重新运行该命令更新。',
    '',
    '## 项目简介',
    '',
    description ? `**${name}** — ${description}` : `**${name}**`,
    '',
    '## 目录结构',
    '',
  ];

  if (dirs.length > 0) {
    lines.push('| 目录 | 说明 |', '|------|------|');
    for (const d of dirs) {
      lines.push(`| \`${d.dir}/\` | ${d.role} |`);
    }
  } else {
    lines.push('（未检测到顶层目录）');
  }

  lines.push('', '## 常用命令', '');
  const pm = detectPackageManager(projectPath);
  const scripts = pkg?.scripts || {};
  const commands = AGENTS_MD_COMMANDS.filter(([n]) => scripts[n]);
  if (commands.length > 0) {
    lines.push('```bash');
    for (const [n, comment] of commands) {
      lines.push(`${formatScriptCommand(pm, n)}  # ${comment}`);
    }
    lines.push('```');
  } else {
    lines.push('（package.json 中未检测到常用脚本）');
  }

  lines.push('', '## 约束与治理', '');
  if (governance.hasConfig) {
    lines.push(`- 治理配置：\`.harness/config.yml\`${governance.preset ? `（preset: ${governance.preset}）` : ''}`);
  }
  if (governance.hasClaudeGovernance) {
    const counts = [
      governance.ironLaws !== undefined ? `Iron Laws ${governance.ironLaws} 条` : null,
      governance.guidelines !== undefined ? `Guidelines ${governance.guidelines} 条` : null,
    ].filter(Boolean).join('、');
    lines.push(`- 约束清单：\`CLAUDE.md\` Governance Rules 块${counts ? `（${counts}）` : ''}`);
  }
  if (!governance.hasConfig && !governance.hasClaudeGovernance) {
    lines.push('- 未检测到 harness 治理配置，可运行 `harness init` 初始化');
  }

  lines.push('', '## 知识入口', '');
  if (hasKnowledge) {
    // 不写条目数：.harness/knowledge 通常不入 git，条数是环境状态，
    // 写进受 --check 漂移比对的文档会制造「必然过期」竞态（任何知识写入都使已提交文档过期）
    lines.push('- `.harness/knowledge/`：项目知识库，用 `harness knowledge` 查询');
  }
  lines.push(
    contextDocCount > 0
      ? `- 各源码目录的 \`CONTEXT.md\` 是权威模块文档（现有 ${contextDocCount} 个），改动代码时同步更新`
      : '- 各源码目录的 `CONTEXT.md` 是权威模块文档，缺失目录可由 `harness sync-docs` 生成模板'
  );
  lines.push('');

  return lines.join('\n');
}

// AGENTS.md PRESERVE 标记块（--agents）
//
// 使用者在 AGENTS.md 中用 `<!-- PRESERVE:名称 -->` / `<!-- /PRESERVE:名称 -->`
// 圈出的区段属于使用者自有内容：重新生成时原样保留（附于生成内容之后，保持相对顺序），
// 漂移比对对块内改动免疫。名称仅允许字母/数字/下划线/连字符，标记须独占一行。

/** PRESERVE 开始标记：独占一行，捕获名称 */
const PRESERVE_BEGIN_RE = /^<!-- PRESERVE:([A-Za-z0-9_-]+) -->\s*$/;

interface PreserveExtraction {
  /** 完整保留块（含首尾标记行，块间不含外部空行），保持原有相对顺序 */
  blocks: string[];
  /** 未闭合（缺同名结束标记）的块名——不予保留，调用方应告警 */
  malformed: string[];
}

/**
 * 从既有 AGENTS.md 提取 PRESERVE 标记块（逐行扫描，结束标记须与开始标记同名）。
 * 块内容原样保留（含标记行）；未闭合的开始标记按普通内容处理并记入 malformed。
 */
function extractPreserveBlocks(content: string): PreserveExtraction {
  const blocks: string[] = [];
  const malformed: string[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(PRESERVE_BEGIN_RE);
    if (!m) {
      i++;
      continue;
    }
    const name = m[1];
    const endMarker = `<!-- /PRESERVE:${name} -->`;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== endMarker) {
      j++;
    }
    if (j >= lines.length) {
      malformed.push(name);
      i++; // 未闭合：跳过开始标记行，其余行按普通内容继续扫描
      continue;
    }
    blocks.push(lines.slice(i, j + 1).join('\n'));
    i = j + 1;
  }
  return { blocks, malformed };
}

/**
 * 组合 AGENTS.md 最终内容：生成部分在前，PRESERVE 块按原序附在文末（空行分隔）。
 * 无保留块时原样返回生成内容（与历史行为一致）；组合结果重跑幂等。
 */
function composeAgentsMd(generated: string, blocks: string[]): string {
  if (blocks.length === 0) return generated;
  const head = generated.replace(/\s*$/, '');
  return head + '\n\n' + blocks.join('\n\n') + '\n';
}

/** 读取 package.json（不存在或无法解析时返回 null） */
async function readPackageJsonLite(dir: string): Promise<PackageJsonLite | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8')) as PackageJsonLite;
  } catch {
    return null;
  }
}

/** 从 .harness/config.yml 读取项目描述（package.json 无 description 时的兜底） */
async function getConfigDescription(projectPath: string): Promise<string> {
  try {
    const content = await fs.readFile(path.join(projectPath, '.harness', 'config.yml'), 'utf-8');
    const config = yaml.load(content) as Record<string, unknown> | undefined;
    return typeof config?.description === 'string' ? config.description : '';
  } catch {
    return '';
  }
}

/** 检测包管理器（决定命令前缀）：pnpm workspace/lockfile → yarn lockfile → 默认 npm */
function detectPackageManager(projectPath: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(path.join(projectPath, 'pnpm-workspace.yaml')) || existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** 格式化脚本调用方式（npm 的 start/test 可省略 run） */
function formatScriptCommand(pm: 'pnpm' | 'yarn' | 'npm', name: string): string {
  if (pm === 'pnpm') return `pnpm ${name}`;
  if (pm === 'yarn') return `yarn ${name}`;
  return name === 'start' || name === 'test' ? `npm ${name}` : `npm run ${name}`;
}

/** 收集顶层目录及其一句话说明（排序保证确定性） */
async function getTopLevelDirEntries(
  projectPath: string,
  srcDirs: string[]
): Promise<Array<{ dir: string; role: string }>> {
  let dirents: import('fs').Dirent[];
  try {
    dirents = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: Array<{ dir: string; role: string }> = [];
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    if (AGENTS_MD_SKIP_DIRS.has(d.name)) continue;
    // 隐藏目录只保留 .harness / .github
    if (d.name.startsWith('.') && d.name !== '.harness' && d.name !== '.github') continue;
    entries.push({ dir: d.name, role: await describeTopLevelDir(projectPath, d.name, srcDirs) });
  }
  entries.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  return entries;
}

/** 顶层目录的一句话说明：知名目录 → monorepo 成员 → 源码根 → 子包 description → 占位 */
async function describeTopLevelDir(projectPath: string, dir: string, srcDirs: string[]): Promise<string> {
  const known = AGENTS_MD_DIR_ROLES[dir];
  if (known) return known;

  if (dir === 'apps' || dir === 'packages') {
    const members = await listWorkspaceMembers(path.join(projectPath, dir));
    if (members.length > 0) {
      return `monorepo ${dir === 'apps' ? '应用' : '共享包'}：${members.join('、')}`;
    }
    return 'monorepo 工作区';
  }

  if (srcDirs.includes(dir)) return '源码目录';

  const subPkg = await readPackageJsonLite(path.join(projectPath, dir));
  if (subPkg?.description) return subPkg.description;

  return '—';
}

/** 列出 monorepo 工作区成员（含 package.json 的子目录名，排序） */
async function listWorkspaceMembers(dir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const members: string[] = [];
    for (const d of dirents) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      if (existsSync(path.join(dir, d.name, 'package.json'))) {
        members.push(d.name);
      }
    }
    return members.sort();
  } catch {
    return [];
  }
}

/** 收集治理信息：.harness/config.yml 与 CLAUDE.md 治理块（含铁律/指南计数） */
async function getGovernanceInfo(projectPath: string): Promise<GovernanceInfo> {
  const info: GovernanceInfo = { hasConfig: false, hasClaudeGovernance: false };

  try {
    const content = await fs.readFile(path.join(projectPath, '.harness', 'config.yml'), 'utf-8');
    const config = yaml.load(content) as Record<string, unknown> | undefined;
    info.hasConfig = true;
    if (config && typeof config.preset === 'string') {
      info.preset = config.preset;
    }
  } catch {
    // 配置不存在
  }

  try {
    const claude = await fs.readFile(path.join(projectPath, 'CLAUDE.md'), 'utf-8');
    if (/^##\s+Governance Rules/m.test(claude) || claude.includes('HARNESS_CONSTRAINTS_START')) {
      info.hasClaudeGovernance = true;
      info.ironLaws = countConstraintBullets(claude, 'Iron Laws');
      info.guidelines = countConstraintBullets(claude, 'Guidelines');
    }
  } catch {
    // CLAUDE.md 不存在
  }

  return info;
}

/** 统计 CLAUDE.md 指定约束分节下的条目数（`- **key**:` 行），分节不存在时返回 undefined */
function countConstraintBullets(content: string, section: string): number | undefined {
  const heading = new RegExp(`^###\\s+${section}[^\\n]*$`, 'm').exec(content);
  if (!heading) return undefined;
  const rest = content.slice(heading.index + heading[0].length);
  const end = rest.search(/^###\s|^\s*<!--\s*HARNESS_CONSTRAINTS_END/m);
  const block = end === -1 ? rest : rest.slice(0, end);
  const items = block.match(/^-\s+\*\*[A-Za-z0-9_]+\*\*/gm);
  return items ? items.length : 0;
}

/** 判断 .harness/knowledge 目录是否存在（只判存在性，不统计条数——条数易变，见 buildAgentsMd 注释） */
async function hasKnowledgeDir(projectPath: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(projectPath, '.harness', 'knowledge'))).isDirectory();
  } catch {
    return false;
  }
}

/** 统计源码根内的 CONTEXT.md 数量（含源码根本身，跨根去重） */
async function countContextDocs(projectPath: string, srcDirs: string[]): Promise<number> {
  const found = new Set<string>();

  async function scan(dir: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      const entryPath = path.join(dir, entry.name);
      if (existsSync(path.join(entryPath, 'CONTEXT.md'))) {
        found.add(entryPath);
      }
      await scan(entryPath);
    }
  }

  for (const root of srcDirs) {
    const rootPath = path.join(projectPath, root);
    if (existsSync(path.join(rootPath, 'CONTEXT.md'))) {
      found.add(rootPath);
    }
    await scan(rootPath);
  }
  return found.size;
}
