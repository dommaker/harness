/**
 * FreshnessRunner — 配置驱动的文档新鲜度检查引擎
 *
 * 所有检查是纯同步文件系统操作，零 LLM 调用。
 * 通过 DocFreshnessConfig 配置驱动，不绑定任何项目结构。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import type {
  DocFreshnessCheck,
  DocFreshnessConfig,
  ChangelogVersionCheck,
  ContextDocsCheck,
  DocDirCheck,
  DocRegexCountCheck,
} from '../../../types/project-config';

/**
 * Freshness 检查结果
 */
export interface FreshnessCheckResult {
  /** 检查类型 */
  type: string;
  /** 人类可读标签 */
  label: string;
  /** 是否通过 */
  pass: boolean;
  /** 失败时的消息 */
  message?: string;
  /** 额外详情 */
  detail?: Record<string, unknown>;
}

/**
 * FreshnessRunner 执行上下文
 */
interface RunContext {
  projectPath: string;
  /** 外部提供的 required_dirs（来自 governance.context_files，用于 context_docs 检查的默认 dirs） */
  requiredDirs?: string[];
  /** 外部提供的约束计数（用于内置 harner harness 的 doc_regex_count） */
  constraintCounts?: {
    ironLaws?: number;
    guidelines?: number;
    tips?: number;
  };
}

/**
 * 配置驱动的文档新鲜度检查引擎
 */
export class FreshnessRunner {
  /**
   * 运行所有配置的文档新鲜度检查
   */
  runAll(
    config: DocFreshnessConfig,
    projectPath: string,
    ctx?: { requiredDirs?: string[]; constraintCounts?: { ironLaws?: number; guidelines?: number; tips?: number } }
  ): FreshnessCheckResult[] {
    if (config.enabled === false) return [];
    if (!config.checks || config.checks.length === 0) return [];

    const context: RunContext = {
      projectPath,
      requiredDirs: ctx?.requiredDirs,
      constraintCounts: ctx?.constraintCounts,
    };

    return config.checks.map(check => this.runSingle(check, context));
  }

  /**
   * 执行单个检查
   */
  runSingle(check: DocFreshnessCheck, context: RunContext): FreshnessCheckResult {
    switch (check.type) {
      case 'changelog_version':
        return this.checkChangelogVersion(check, context);
      case 'context_docs':
        return this.checkContextDocs(check, context);
      case 'doc_dir_check':
        return this.checkDocDir(check, context);
      case 'doc_regex_count':
        return this.checkDocRegexCount(check, context);
      default:
        return {
          type: (check as any).type || 'unknown',
          label: 'Unknown',
          pass: true,
          message: `未知的检查类型: ${(check as any).type}`,
        };
    }
  }

  // ── changelog_version ────────────────────────────────────────────

  private checkChangelogVersion(
    check: ChangelogVersionCheck,
    ctx: RunContext
  ): FreshnessCheckResult {
    const changelogPath = join(ctx.projectPath, check.changelog || 'CHANGELOG.md');
    const pkgPath = join(ctx.projectPath, check.package_json || 'package.json');

    try {
      if (!existsSync(changelogPath)) {
        return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
      }

      const changelogContent = readFileSync(changelogPath, 'utf-8');
      const versionMatch = changelogContent.match(/##\s*\[(\d+\.\d+\.\d+)\]/);
      if (!versionMatch) {
        return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
      }

      const changelogVersion = versionMatch[1];

      if (!existsSync(pkgPath)) {
        return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
      }

      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const pkgVersion = pkg.version as string;

      const pass = changelogVersion === pkgVersion;
      return {
        type: 'changelog_version',
        label: 'CHANGELOG Version',
        pass,
        message: pass ? undefined : `CHANGELOG.md 版本 ${changelogVersion} !== package.json 版本 ${pkgVersion}`,
        detail: { changelogVersion, pkgVersion },
      };
    } catch {
      return { type: 'changelog_version', label: 'CHANGELOG Version', pass: true };
    }
  }

  // ── context_docs ─────────────────────────────────────────────────

  private checkContextDocs(
    check: ContextDocsCheck,
    ctx: RunContext
  ): FreshnessCheckResult {
    const dirs = check.dirs || ctx.requiredDirs;
    if (!dirs || dirs.length === 0) {
      return { type: 'context_docs', label: 'CONTEXT.md', pass: true };
    }

    const docName = check.doc_name || 'CONTEXT.md';
    const missing: string[] = [];

    for (const dir of dirs) {
      const docPath = join(ctx.projectPath, dir, docName);
      if (!existsSync(docPath)) {
        missing.push(dir);
      }
    }

    const pass = missing.length === 0;
    return {
      type: 'context_docs',
      label: 'CONTEXT.md',
      pass,
      message: pass ? undefined : `缺少 ${docName}: ${missing.join(', ')}`,
      detail: { missing, doc_name: docName },
    };
  }

  // ── doc_dir_check ────────────────────────────────────────────────

  private checkDocDir(
    check: DocDirCheck,
    ctx: RunContext
  ): FreshnessCheckResult {
    try {
      const docPath = join(ctx.projectPath, check.doc);
      if (!existsSync(docPath)) {
        return {
          type: 'doc_dir_check',
          label: `${check.doc} / ${check.section}`,
          pass: true,
          message: `${check.doc} 不存在，跳过检查`,
        };
      }

      const content = readFileSync(docPath, 'utf-8');

      // 提取目标章节（$ 不要求末尾有 \n，适配无 trailing newline 的内容）
      const sectionRegex = new RegExp(
        `## ${this.escapeRegExp(check.section)}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`
      );
      const sectionMatch = content.match(sectionRegex);
      if (!sectionMatch) {
        return {
          type: 'doc_dir_check',
          label: `${check.doc} / ${check.section}`,
          pass: true,
          message: `未找到 "${check.section}" 章节`,
        };
      }

      const section = sectionMatch[1];

      // 提取目录
      const dirPattern = check.dir_pattern || '`([^`]+)`';
      const dirRegex = new RegExp(dirPattern, 'g');
      const docDirs = new Set<string>();
      let match;
      while ((match = dirRegex.exec(section)) !== null) {
        const dirPath = match[1].replace(/\/$/, '').trim();
        // 只收集看起来像目录的路径（包含 / 或以特定前缀开头）
        // 宽松匹配：任何非空字符串
        if (dirPath.length > 0) {
          docDirs.add(dirPath);
        }
      }

      if (docDirs.size === 0) {
        return {
          type: 'doc_dir_check',
          label: `${check.doc} / ${check.section}`,
          pass: true,
          message: `"${check.section}" 章节中未找到目录引用`,
        };
      }

      const failures: string[] = [];

      // 1. doc → fs: 文档中每个目录必须实际存在于磁盘
      for (const dir of docDirs) {
        if (!existsSync(join(ctx.projectPath, dir))) {
          failures.push(`文档引用但不存在: ${dir}`);
        }
      }

      // 2. fs → doc: 每个实际目录必须在文档中被覆盖
      if (!check.skip_reverse_check) {
        // 从文档目录中推断要扫描的根目录集
        const rootDirs = this.inferRootDirs(docDirs, ctx.projectPath);
        const excludeSet = new Set(check.exclude || ['__tests__', 'node_modules', 'dist']);

        for (const rootDir of rootDirs) {
          const absRoot = join(ctx.projectPath, rootDir);
          if (!existsSync(absRoot)) continue;

          try {
            const entries = readdirSync(absRoot, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              if (excludeSet.has(entry.name)) continue;
              if (entry.name.startsWith('__') || entry.name.startsWith('.')) continue;

              const actualDir = `${rootDir}/${entry.name}`;
              // 直接匹配 or 任何文档条目是该目录的子目录
              if (docDirs.has(actualDir)) continue;
              const covered = [...docDirs].some(d => d.startsWith(actualDir + '/'));
              if (!covered) {
                failures.push(`存在但未在文档中覆盖: ${actualDir}`);
              }
            }
          } catch {
            // 扫描失败，跳过
          }
        }
      }

      const pass = failures.length === 0;
      return {
        type: 'doc_dir_check',
        label: `${check.doc} / ${check.section}`,
        pass,
        message: pass ? undefined : failures.join('; '),
        detail: { docDirs: [...docDirs], failures },
      };
    } catch {
      return {
        type: 'doc_dir_check',
        label: `${check.doc} / ${check.section}`,
        pass: true,
      };
    }
  }

  /**
   * 从文档目录集合推断要扫描的根目录
   * 例如 ["src/core", "src/cli/commands"] → ["src"]
   */
  private inferRootDirs(docDirs: Set<string>, projectPath: string): string[] {
    const roots = new Set<string>();

    for (const dir of docDirs) {
      // 取第一个路径段之前的公共部分
      const parts = dir.split('/');
      // 收集可能的根（单段目录如 "src/xxx" → 根是 "src"）
      if (parts.length >= 2) {
        roots.add(parts.slice(0, parts.length - 1).join('/') || parts[0]);
      }
    }

    // 合并为最小公共根集
    // 简单策略：如果有 "src/a" 和 "src/b"，则根是 "src"
    const merged = new Set<string>();
    for (const root of roots) {
      let isSubsumed = false;
      for (const other of roots) {
        if (root !== other && root.startsWith(other + '/')) {
          isSubsumed = true;
          break;
        }
      }
      if (!isSubsumed) {
        merged.add(root);
      }
    }

    return merged.size > 0 ? [...merged] : ['src'];
  }

  // ── doc_regex_count ──────────────────────────────────────────────

  private checkDocRegexCount(
    check: DocRegexCountCheck,
    ctx: RunContext
  ): FreshnessCheckResult {
    try {
      const docPath = join(ctx.projectPath, check.doc);
      if (!existsSync(docPath)) {
        return {
          type: 'doc_regex_count',
          label: `${check.doc} / ${check.label}`,
          pass: true,
          message: `${check.doc} 不存在，跳过检查`,
        };
      }

      const content = readFileSync(docPath, 'utf-8');

      // 从文档中提取声明的计数
      const countRegex = new RegExp(check.pattern);
      const countMatch = content.match(countRegex);
      if (!countMatch || countMatch[1] === undefined) {
        return {
          type: 'doc_regex_count',
          label: `${check.doc} / ${check.label}`,
          pass: true,
          message: `未在 ${check.doc} 中找到匹配 "${check.label}" 的计数行`,
        };
      }

      const docCount = parseInt(countMatch[1], 10);
      if (isNaN(docCount)) {
        return {
          type: 'doc_regex_count',
          label: `${check.doc} / ${check.label}`,
          pass: true,
          message: `计数解析失败: ${countMatch[1]}`,
        };
      }

      // 获取实际计数
      let actualCount: number;
      if (check.actual.kind === 'dir_count') {
        actualCount = this.countFromDir(check.actual.path, check.actual.extension || '.ts', check.actual.exclude || [], ctx.projectPath);
      } else if (check.actual.kind === 'grep_count') {
        actualCount = this.countFromGrep(ctx.projectPath, check.actual.glob, check.actual.pattern);
      } else {
        actualCount = check.actual.value;
      }

      if (actualCount < 0) {
        return {
          type: 'doc_regex_count',
          label: `${check.doc} / ${check.label}`,
          pass: true,
        };
      }

      const pass = docCount === actualCount;
      return {
        type: 'doc_regex_count',
        label: `${check.doc} / ${check.label}`,
        pass,
        message: pass ? undefined : `${check.label}: 文档 ${docCount} → 实际 ${actualCount}`,
        detail: { docCount, actualCount },
      };
    } catch {
      return {
        type: 'doc_regex_count',
        label: `${check.doc} / ${check.label}`,
        pass: true,
      };
    }
  }

  /**
   * 从目录中计数匹配的文件/条目
   */
  countFromDir(
    dirPath: string,
    extension: string,
    exclude: string[],
    projectPath: string
  ): number {
    const absDir = join(projectPath, dirPath);
    if (!existsSync(absDir)) return -1;

    try {
      const entries = readdirSync(absDir, { withFileTypes: true });
      const excludeSet = new Set(exclude);

      let count = 0;
      for (const entry of entries) {
        if (excludeSet.has(entry.name)) continue;

        if (entry.isDirectory() && !entry.name.startsWith('__') && !entry.name.startsWith('.')) {
          // 目录：计 1（.ts 过滤不适用于目录）
          count++;
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          // 排除 .d.ts
          if (!entry.name.endsWith('.d.ts')) {
            count++;
          }
        }
      }

      return count;
    } catch {
      return -1;
    }
  }

  /**
   * 从 grep 匹配中计数
   */
  countFromGrep(
    projectPath: string,
    globPattern: string,
    pattern: string
  ): number {
    try {
      // globPattern 如 "src/gates/*.ts"
      const absGlob = join(projectPath, globPattern);

      // 分离目录和文件名模式
      const lastSlash = absGlob.lastIndexOf('/');
      const searchDir = absGlob.substring(0, lastSlash);
      const filePattern = absGlob.substring(lastSlash + 1);

      if (!existsSync(searchDir)) return -1;

      // 将 glob * 转换为简单的 endsWith 检查
      const suffix = filePattern.replace(/\*/g, '');

      const entries = readdirSync(searchDir, { withFileTypes: true });
      const reg = new RegExp(pattern);

      let count = 0;
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(suffix)) continue;

        try {
          const content = readFileSync(join(searchDir, entry.name), 'utf-8');
          const matches = content.match(new RegExp(pattern, 'g'));
          if (matches) {
            count += matches.length;
          }
        } catch {
          // skip
        }
      }

      return count;
    } catch {
      return -1;
    }
  }

  // ── helpers ──────────────────────────────────────────────────────

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
