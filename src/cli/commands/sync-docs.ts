/**
 * harness sync-docs 命令
 *
 * 自动同步项目文档：CAPABILITIES.md、CONTEXT.md 检查、CHANGELOG 辅助
 * --check 模式输出结构化信息，供 LLM 或 CI 消费
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface SyncDocsOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 只检查，不写入（CI 模式） */
  check?: boolean;
  /** 是否生成 CHANGELOG 条目 */
  changelog?: boolean;
  /** 输出 JSON 格式（供 LLM 消费） */
  json?: boolean;
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

  // 1. 扫描源码模块
  const srcDir = path.join(projectPath, 'src');
  let currentModules: ModuleInfo[] = [];
  try {
    currentModules = await scanSourceModules(srcDir);
  } catch {
    if (!isJson) {
      console.log(chalk.yellow('⚠️  未找到 src/ 目录，跳过模块扫描'));
    }
  }

  // 2. 解析现有 CAPABILITIES.md
  const capabilitiesPath = path.join(projectPath, 'CAPABILITIES.md');
  let existingFiles: string[] = [];
  try {
    existingFiles = await parseCapabilitiesFiles(capabilitiesPath);
  } catch {
    // CAPABILITIES.md 不存在，所有模块都是新增
  }

  // 3. 对比差异（基于文件名模糊匹配：CAPABILITIES.md 各章节路径格式不一致）
  const getBasename = (f: string) => {
    const clean = f.endsWith('/') ? f.slice(0, -1) : f;
    return clean.split('/').pop()!;
  };
  const currentBasenames = currentModules.map(m => getBasename(m.file));
  result.added = currentBasenames.filter(f => !existingFiles.includes(f));
  result.removed = existingFiles.filter(f => !currentBasenames.includes(f));

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
  const existingContextFiles = await findExistingContextFiles(projectPath, srcDir);
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

  // 5. JSON 输出模式：结构化输出供 LLM 消费
  if (isJson) {
    const hasChanges = result.added.length > 0 || result.removed.length > 0 || result.contextMissing.length > 0 || result.contextStale.length > 0;
    const jsonOutput = {
      stale: hasChanges,
      summary: {
        added: result.added.length,
        removed: result.removed.length,
        contextMissing: result.contextMissing.length,
        contextStale: result.contextStale.length,
      },
      added: result.added.map(f => ({
        file: f,
        module: currentModules.find(m => getBasename(m.file) === f),
      })),
      removed: result.removed.map(f => ({ file: f })),
      contextMissing: result.contextMissing.map(d => ({
        dir: d,
        file: `${d}/CONTEXT.md`,
      })),
      contextStale: result.contextStale.map(d => ({
        dir: d,
        file: `${d}/CONTEXT.md`,
      })),
      resolution: [
        ...(result.added.length > 0 || result.removed.length > 0
          ? [{ action: 'sync-capabilities', command: 'harness sync-docs' }]
          : []),
        ...(result.contextMissing.length > 0
          ? [{ action: 'create-context-md', command: 'harness sync-docs', dirs: result.contextMissing }]
          : []),
        ...(result.contextStale.length > 0
          ? [{ action: 'update-context-md', command: 'harness sync-docs', dirs: result.contextStale }]
          : []),
      ],
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return !hasChanges;
  }

  // 6. 人读输出模式
  let hasIssues = false;

  if (result.added.length > 0) {
    hasIssues = true;
    console.log(chalk.yellow(`\n📄 CAPABILITIES.md 缺少以下模块:`));
    result.added.forEach(f => console.log(chalk.gray(`  + ${f}`)));
  }

  if (result.removed.length > 0) {
    hasIssues = true;
    console.log(chalk.yellow(`\n📄 CAPABILITIES.md 包含已删除的模块:`));
    result.removed.forEach(f => console.log(chalk.gray(`  - ${f}`)));
  }

  if (result.contextMissing.length > 0) {
    hasIssues = true;
    console.log(chalk.yellow(`\n📋 缺少 CONTEXT.md:`));
    result.contextMissing.forEach(d => console.log(chalk.gray(`  - ${d}/CONTEXT.md`)));
  }

  if (result.contextStale.length > 0) {
    hasIssues = true;
    console.log(chalk.yellow(`\n📋 CONTEXT.md 可能过时（源码比文档新）:`));
    result.contextStale.forEach(d => console.log(chalk.gray(`  - ${d}/CONTEXT.md`)));
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

  // 8. 基础模式：直接更新
  if (result.added.length > 0 || result.removed.length > 0) {
    await updateCapabilitiesFile(capabilitiesPath, currentModules, existingFiles, result);
    console.log(chalk.green(`\n✅ 已更新 CAPABILITIES.md`));
  }

  for (const dir of result.contextMissing) {
    await createContextMd(projectPath, dir);
    console.log(chalk.green(`✅ 已创建 ${dir}/CONTEXT.md`));
  }

  // 9. CHANGELOG 辅助
  if (options.changelog) {
    await generateChangelogEntry(projectPath, result);
  }

  return !hasIssues;
}

/**
 * 扫描 src/ 目录，提取模块信息
 */
async function scanSourceModules(srcDir: string): Promise<ModuleInfo[]> {
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
        const relPath = path.relative(path.dirname(srcDir), f);
        modules.push({
          name: path.basename(f, '.ts'),
          file: relPath,
          description: await extractFileDescription(f),
        });
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && entry !== 'index.ts') {
      modules.push({
        name: path.basename(entry, '.ts'),
        file: `src/${entry}`,
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
 * 自动发现已有 CONTEXT.md 文件的目录（相对于 srcDir）
 */
async function findExistingContextFiles(projectPath: string, srcDir: string): Promise<string[]> {
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

  await scan(srcDir);
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
    if (contextFiles?.enabled && Array.isArray(contextFiles.required_dirs)) {
      return contextFiles.required_dirs as string[];
    }
  } catch {
    // 配置不存在或无法解析
  }
  return [];
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
      const rowRegex = new RegExp(`^\\|[^|]*\\|\\s*${escapedFile}\\s*\\|.*$`, 'gm');
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

> 此文件描述 ${dir} 目录的职责和上下文

## 职责

<!-- 本目录的核心职责是什么 -->

## 核心导出

<!-- 本目录对外暴露的主要模块/函数 -->

## 依赖关系

<!-- 本目录依赖哪些其他模块，谁依赖本目录 -->

## 注意事项

<!-- 开发时需要注意的约束或约定 -->
`;

  await fs.mkdir(path.join(projectPath, dir), { recursive: true });
  await fs.writeFile(contextPath, content, 'utf-8');
}

/**
 * 生成 CHANGELOG 条目
 */
async function generateChangelogEntry(projectPath: string, result: SyncResult): Promise<void> {
  const changelogPath = path.join(projectPath, 'CHANGELOG.md');

  let changelogExists = false;
  try {
    await fs.access(changelogPath);
    changelogExists = true;
  } catch {
    // CHANGELOG.md 不存在
  }

  if (!changelogExists) {
    console.log(chalk.yellow('⚠️  CHANGELOG.md 不存在，跳过 changelog 生成'));
    return;
  }

  const changes: string[] = [];
  if (result.added.length > 0) {
    changes.push(`### Added\n${result.added.map(f => `- ${f}`).join('\n')}`);
  }
  if (result.removed.length > 0) {
    changes.push(`### Removed\n${result.removed.map(f => `- ${f}`).join('\n')}`);
  }

  if (changes.length === 0) return;

  const now = new Date().toISOString().split('T')[0];
  const entry = `\n## [${now}]\n\n${changes.join('\n\n')}\n`;

  const content = await fs.readFile(changelogPath, 'utf-8');
  // 在 ## [Unreleased] 之后插入
  const unreleasedIndex = content.indexOf('## [Unreleased]');
  if (unreleasedIndex !== -1) {
    const insertPos = content.indexOf('\n', unreleasedIndex + 1);
    const newContent = content.slice(0, insertPos) + entry + content.slice(insertPos);
    await fs.writeFile(changelogPath, newContent, 'utf-8');
    console.log(chalk.green('✅ 已更新 CHANGELOG.md'));
  } else {
    // 追加到末尾
    await fs.appendFile(changelogPath, entry, 'utf-8');
    console.log(chalk.green('✅ 已追加 CHANGELOG.md 条目'));
  }
}
