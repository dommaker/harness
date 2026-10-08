/**
 * 冷启动导入
 *
 * 从已有项目中批量提取知识：
 * - 代码仓库扫描（技术栈、模块、依赖、模式）
 * - Git 历史分析（架构决策、重构记录、hotfix 原因）
 * - 文档导入（README、设计文档）
 * - 口述录入（结构化模板）
 *
 * 所有导入知识初始 maturity: draft
 * 通过 .harness/import-state.json 持久化进度，支持中断后继续
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { readPackageJson } from '../utils/package-json';
import { attempt } from '../utils/attempt';
import type { KnowledgeEntry, KnowledgeSubsystem, StorageLayer } from './types';
import type { KnowledgeStore } from './store';

// ── 导入源 ───────────────────────────────────────────────

export interface ImportSource {
  type: 'code' | 'git' | 'docs' | 'manual';
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportResult {
  source: ImportSource;
  entries: KnowledgeEntry[];
  errors: ImportError[];
}

export interface ImportError {
  source: ImportSource;
  message: string;
}

// ── 导入状态 ─────────────────────────────────────────────

export interface ImportState {
  projectRoot: string;
  startedAt: string;
  lastUpdated: string;
  completedSources: string[];
  totalImported: number;
  totalErrors: number;
}

// ── 导入配置 ─────────────────────────────────────────────

export interface ImportConfig {
  projectRoot: string;
  store: KnowledgeStore;
  /** 要导入的源类型 */
  sources: Array<'code' | 'git' | 'docs' | 'manual'>;
  /** 自定义文档路径 */
  docPaths?: string[];
  /** 自定义导入条目（口述录入） */
  manualEntries?: Array<{
    title: string;
    content: string;
    type: KnowledgeSubsystem;
    tags?: string[];
  }>;
  /** 是否跳过已导入的 */
  skipExisting?: boolean;
}

const STATE_FILE = '.harness/import-state.json';

// ── 冷启动导入器 ─────────────────────────────────────────

export class ColdStartImporter {
  private config: ImportConfig;
  private state: ImportState;

  constructor(config: ImportConfig) {
    this.config = config;
    this.state = this.loadState();
  }

  /**
   * 执行完整导入
   */
  async importAll(): Promise<ImportResult[]> {
    const results: ImportResult[] = [];

    for (const sourceType of this.config.sources) {
      if (this.state.completedSources.includes(sourceType)) {
        continue;
      }

      // 降级记名（attempt，fail-open）：单源失败记进 result.errors——CLI 输出面露出错误行
      // 与错误计数——并继续后续源，不拖死整批冷启动导入；非静默吞错
      const result = attempt(
        () => this.dispatchSource(sourceType),
        (err): ImportResult => ({
          source: { type: sourceType },
          entries: [],
          errors: [{
            source: { type: sourceType },
            message: `${sourceType} 导入失败: ${err instanceof Error ? err.message : String(err)}`,
          }],
        })
      );

      results.push(result);

      // 持久化进度
      this.state.completedSources.push(sourceType);
      this.state.totalImported += result.entries.length;
      this.state.totalErrors += result.errors.length;
      this.state.lastUpdated = new Date().toISOString();
      this.saveState();
    }

    return results;
  }

  private dispatchSource(sourceType: ImportSource['type']): ImportResult {
    switch (sourceType) {
      case 'code':
        return this.importFromCode();
      case 'git':
        return this.importFromGit();
      case 'docs':
        return this.importFromDocs();
      case 'manual':
        return this.importManual();
      default:
        // sourceType 静态收窄为 never（switch 已穷尽四源）；分支防的是运行时脏配置
        throw new Error(`未知源类型: ${String(sourceType)}`);
    }
  }

  /**
   * 从代码仓库扫描提取知识
   */
  private importFromCode(): ImportResult {
    const entries: KnowledgeEntry[] = [];
    const source: ImportSource = { type: 'code', path: this.config.projectRoot };

    // 扫描 package.json 获取技术栈（缺失 → 无条目；损坏 → 抛出，由 importAll 记名降级为错误行）
    const pkg = readPackageJson(this.config.projectRoot);
    if (pkg) {
      entries.push(this.createEntry({
        title: `技术栈: ${pkg.name || 'unknown'}`,
        content: this.formatPackageInfo(pkg),
        type: 'model',
        tags: ['tech-stack', 'auto-import'],
        layer: 'project',
      }));
    }

    // 扫描 tsconfig.json
    const tsconfigPath = path.join(this.config.projectRoot, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      entries.push(this.createEntry({
        title: 'TypeScript 配置',
        content: fs.readFileSync(tsconfigPath, 'utf-8'),
        type: 'model',
        tags: ['typescript', 'config', 'auto-import'],
        layer: 'project',
      }));
    }

    // 扫描目录结构
    const dirs = this.scanDirectoryStructure(this.config.projectRoot);
    if (dirs.length > 0) {
      entries.push(this.createEntry({
        title: '项目目录结构',
        content: dirs.join('\n'),
        type: 'model',
        tags: ['architecture', 'auto-import'],
        layer: 'project',
      }));
    }

    // 写入知识库
    this.config.store.saveAll(entries);

    return { source, entries, errors: [] };
  }

  /**
   * 从 Git 历史分析提取知识
   */
  private importFromGit(): ImportResult {
    const entries: KnowledgeEntry[] = [];
    const source: ImportSource = { type: 'git', path: this.config.projectRoot };
    const cwd = this.config.projectRoot;

    // 查找 fix/hotfix 相关提交
    const fixCommits = execSync(
      'git log --oneline --grep="fix\\|hotfix\\|bug" --since="6 months ago" | head -20',
      { cwd, encoding: 'utf-8', timeout: 10000 },
    );

    if (fixCommits.trim()) {
      entries.push(this.createEntry({
        title: '近期 Bug 修复记录',
        content: fixCommits.trim(),
        type: 'pitfall',
        tags: ['git-history', 'bug-fix', 'auto-import'],
        layer: 'project',
      }));
    }

    // 查找 refactor 相关提交
    const refactorCommits = execSync(
      'git log --oneline --grep="refactor\\|重构" --since="6 months ago" | head -20',
      { cwd, encoding: 'utf-8', timeout: 10000 },
    );

    if (refactorCommits.trim()) {
      entries.push(this.createEntry({
        title: '近期重构记录',
        content: refactorCommits.trim(),
        type: 'decision',
        tags: ['git-history', 'refactor', 'auto-import'],
        layer: 'project',
      }));
    }

    this.config.store.saveAll(entries);

    return { source, entries, errors: [] };
  }

  /**
   * 从文档导入
   */
  private importFromDocs(): ImportResult {
    const entries: KnowledgeEntry[] = [];
    const source: ImportSource = { type: 'docs' };

    const docPaths = this.config.docPaths ?? [
      'README.md',
      'ARCHITECTURE.md',
      'CONTRIBUTING.md',
      'docs/',
    ];

    for (const docPath of docPaths) {
      const fullPath = path.join(this.config.projectRoot, docPath);
      if (!fs.existsSync(fullPath)) continue;

      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // 扫描目录下的 markdown 文件
        // 口径记名（harness#134）：本 walker 吃的是**项目文档树**（README/docs/），不是知识库树，
        // 故不适用 tree-walker 的条目排除口径——知识树的 `_index.md`/`.snapshots` 在这里没有对应物。
        const files = fs.readdirSync(fullPath)
          .filter(f => f.endsWith('.md'))
          .slice(0, 10); // 最多 10 个

        for (const file of files) {
          const filePath = path.join(fullPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.length > 0) {
            entries.push(this.createEntry({
              title: `文档: ${docPath}${file}`,
              content: content.slice(0, 5000), // 限制大小
              type: 'guideline',
              tags: ['docs', 'auto-import'],
              layer: 'project',
            }));
          }
        }
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.length > 0) {
          entries.push(this.createEntry({
            title: `文档: ${docPath}`,
            content: content.slice(0, 5000),
            type: 'guideline',
            tags: ['docs', 'auto-import'],
            layer: 'project',
          }));
        }
      }
    }

    this.config.store.saveAll(entries);

    return { source, entries, errors: [] };
  }

  /**
   * 口述录入
   */
  private importManual(): ImportResult {
    const entries: KnowledgeEntry[] = [];
    const source: ImportSource = { type: 'manual' };

    for (const item of this.config.manualEntries ?? []) {
      entries.push(this.createEntry({
        title: item.title,
        content: item.content,
        type: item.type,
        tags: [...(item.tags ?? []), 'manual-import'],
        layer: 'project',
      }));
    }

    this.config.store.saveAll(entries);

    return { source, entries, errors: [] };
  }

  // ── 辅助方法 ───────────────────────────────────────────

  private createEntry(params: {
    title: string;
    content: string;
    type: KnowledgeSubsystem;
    tags: string[];
    layer: StorageLayer;
  }): KnowledgeEntry {
    return {
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: params.type,
      title: params.title,
      content: params.content,
      maturity: 'draft',
      layer: params.layer,
      created: new Date().toISOString(),
      lastReferenced: '',
      contributors: [],
      projects: [],
      tags: params.tags,
      applicablePhases: [],
      sourceReferences: [{
        workflow: 'cold-start-import',
        timestamp: new Date().toISOString(),
      }],
      referencedBy: [],
      executionResults: [],
      consumptionMode: 'reference',
      origin: 'system',
    };
  }

  private formatPackageInfo(pkg: Record<string, unknown>): string {
    const parts: string[] = [];
    if (pkg.name) parts.push(`名称: ${pkg.name}`);
    if (pkg.version) parts.push(`版本: ${pkg.version}`);
    if (pkg.description) parts.push(`描述: ${pkg.description}`);

    const deps = pkg.dependencies as Record<string, string> | undefined;
    if (deps) {
      parts.push(`\n依赖 (${Object.keys(deps).length}):`);
      for (const [name, version] of Object.entries(deps).slice(0, 20)) {
        parts.push(`  - ${name}: ${version}`);
      }
    }

    const devDeps = pkg.devDependencies as Record<string, string> | undefined;
    if (devDeps) {
      parts.push(`\n开发依赖 (${Object.keys(devDeps).length}):`);
      for (const [name, version] of Object.entries(devDeps).slice(0, 10)) {
        parts.push(`  - ${name}: ${version}`);
      }
    }

    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (scripts) {
      parts.push(`\n脚本:`);
      for (const [name, cmd] of Object.entries(scripts).slice(0, 10)) {
        parts.push(`  - ${name}: ${cmd}`);
      }
    }

    return parts.join('\n');
  }

  private scanDirectoryStructure(root: string, maxDepth: number = 2): string[] {
    const dirs: string[] = [];
    const ignore = new Set(['node_modules', '.git', '.harness', 'dist', 'coverage', '.next']);

    const scan = (dir: string, depth: number) => {
      if (depth > maxDepth) return;

      // 目录不可读（权限等）直抛，由 importAll 的记名降级露成错误行——
      // 静默跳过会让「目录结构」条目悄悄缺胳膊少腿
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignore.has(entry.name)) continue;
        if (!entry.isDirectory()) continue;

        const relative = path.relative(root, path.join(dir, entry.name));
        dirs.push(relative || entry.name);
        scan(path.join(dir, entry.name), depth + 1);
      }
    };

    scan(root, 0);
    return dirs;
  }

  private loadState(): ImportState {
    const statePath = path.join(this.config.projectRoot, STATE_FILE);
    if (fs.existsSync(statePath)) {
      // fail-fast：状态文件在场但损坏直接抛（对齐 store.ts「损坏 ≠ 缺失」口径）——
      // 静默重置会把已完成源再导入一遍，重复条目落库
      return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as ImportState;
    }

    return {
      projectRoot: this.config.projectRoot,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      completedSources: [],
      totalImported: 0,
      totalErrors: 0,
    };
  }

  private saveState(): void {
    const statePath = path.join(this.config.projectRoot, STATE_FILE);
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /**
   * 获取当前导入状态
   */
  getState(): ImportState {
    return { ...this.state };
  }

  /**
   * 重置导入状态
   */
  resetState(): void {
    this.state = {
      projectRoot: this.config.projectRoot,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      completedSources: [],
      totalImported: 0,
      totalErrors: 0,
    };
    this.saveState();
  }
}
