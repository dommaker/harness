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
import type { KnowledgeEntry, KnowledgeType, MaturityLevel, StorageLayer } from './types';
import { KnowledgeStore } from './store';

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
  recoverable: boolean;
}

// ── 导入状态 ─────────────────────────────────────────────

export interface ImportState {
  projectRoot: string;
  startedAt: string;
  lastUpdated: string;
  completedSources: string[];
  pendingSources: string[];
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
    type: KnowledgeType;
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

      let result: ImportResult;

      switch (sourceType) {
        case 'code':
          result = await this.importFromCode();
          break;
        case 'git':
          result = await this.importFromGit();
          break;
        case 'docs':
          result = await this.importFromDocs();
          break;
        case 'manual':
          result = await this.importManual();
          break;
        default:
          result = {
            source: { type: sourceType as any },
            entries: [],
            errors: [{ source: { type: sourceType as any }, message: `未知源类型: ${sourceType}`, recoverable: false }],
          };
      }

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

  /**
   * 从代码仓库扫描提取知识
   */
  private async importFromCode(): Promise<ImportResult> {
    const entries: KnowledgeEntry[] = [];
    const errors: ImportError[] = [];
    const source: ImportSource = { type: 'code', path: this.config.projectRoot };

    try {
      // 扫描 package.json 获取技术栈
      const pkgPath = path.join(this.config.projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
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
    } catch (error) {
      errors.push({
        source,
        message: `代码扫描失败: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
    }

    // 写入知识库
    for (const entry of entries) {
      this.config.store.save(entry);
    }

    return { source, entries, errors };
  }

  /**
   * 从 Git 历史分析提取知识
   */
  private async importFromGit(): Promise<ImportResult> {
    const entries: KnowledgeEntry[] = [];
    const errors: ImportError[] = [];
    const source: ImportSource = { type: 'git', path: this.config.projectRoot };

    try {
      const { execSync } = require('child_process');
      const cwd = this.config.projectRoot;

      // 分析大型重构提交
      const bigCommits = execSync(
        'git log --oneline --diff-filter=M --numstat --since="6 months ago" | head -100',
        { cwd, encoding: 'utf-8', timeout: 10000 },
      );

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
    } catch (error) {
      errors.push({
        source,
        message: `Git 分析失败: ${error instanceof Error ? error.message : String(error)}`,
        recoverable: true,
      });
    }

    for (const entry of entries) {
      this.config.store.save(entry);
    }

    return { source, entries, errors };
  }

  /**
   * 从文档导入
   */
  private async importFromDocs(): Promise<ImportResult> {
    const entries: KnowledgeEntry[] = [];
    const errors: ImportError[] = [];
    const source: ImportSource = { type: 'docs' };

    const docPaths = this.config.docPaths ?? [
      'README.md',
      'ARCHITECTURE.md',
      'CONTRIBUTING.md',
      'docs/',
    ];

    for (const docPath of docPaths) {
      const fullPath = path.join(this.config.projectRoot, docPath);

      try {
        if (!fs.existsSync(fullPath)) continue;

        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // 扫描目录下的 markdown 文件
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
      } catch (error) {
        errors.push({
          source: { type: 'docs', path: docPath },
          message: `文档导入失败 ${docPath}: ${error instanceof Error ? error.message : String(error)}`,
          recoverable: true,
        });
      }
    }

    for (const entry of entries) {
      this.config.store.save(entry);
    }

    return { source, entries, errors };
  }

  /**
   * 口述录入
   */
  private async importManual(): Promise<ImportResult> {
    const entries: KnowledgeEntry[] = [];
    const errors: ImportError[] = [];
    const source: ImportSource = { type: 'manual' };

    if (!this.config.manualEntries || this.config.manualEntries.length === 0) {
      return { source, entries, errors };
    }

    for (const item of this.config.manualEntries) {
      try {
        entries.push(this.createEntry({
          title: item.title,
          content: item.content,
          type: item.type,
          tags: [...(item.tags ?? []), 'manual-import'],
          layer: 'project',
        }));
      } catch (error) {
        errors.push({
          source,
          message: `口述录入失败: ${error instanceof Error ? error.message : String(error)}`,
          recoverable: true,
        });
      }
    }

    for (const entry of entries) {
      this.config.store.save(entry);
    }

    return { source, entries, errors };
  }

  // ── 辅助方法 ───────────────────────────────────────────

  private createEntry(params: {
    title: string;
    content: string;
    type: KnowledgeType;
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

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (ignore.has(entry.name)) continue;
          if (!entry.isDirectory()) continue;

          const relative = path.relative(root, path.join(dir, entry.name));
          dirs.push(relative || entry.name);
          scan(path.join(dir, entry.name), depth + 1);
        }
      } catch {
        // skip unreadable directories
      }
    };

    scan(root, 0);
    return dirs;
  }

  private loadState(): ImportState {
    const statePath = path.join(this.config.projectRoot, STATE_FILE);
    if (fs.existsSync(statePath)) {
      try {
        return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      } catch {
        // corrupt state, start fresh
      }
    }

    return {
      projectRoot: this.config.projectRoot,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      completedSources: [],
      pendingSources: [...this.config.sources],
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
      pendingSources: [...this.config.sources],
      totalImported: 0,
      totalErrors: 0,
    };
    this.saveState();
  }
}
