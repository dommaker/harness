/**
 * 治理执行器
 *
 * 检测差异 → 返回结果 → LLM 自行修复
 * harness 只做检测，不做修复
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  GovernanceDiff,
  GovernanceResult,
} from './types';

export class GovernanceExecutor {
  /**
   * 执行治理检查
   *
   * 检测差异并返回结果，不调用 hook，不执行修复
   * LLM 拿到结果后自行决定如何处理
   */
  async check(projectPath: string): Promise<GovernanceResult> {
    const diffs = await this.detectDiffs(projectPath);

    return {
      hasDiffs: diffs.length > 0,
      diffs,
    };
  }

  /**
   * 检测项目中的治理差异
   */
  async detectDiffs(projectPath: string): Promise<GovernanceDiff[]> {
    const diffs: GovernanceDiff[] = [];

    // 1. 检查 CAPABILITIES.md 与源码的差异
    const capDiffs = await this.checkCapabilitiesSync(projectPath);
    diffs.push(...capDiffs);

    // 2. 检查 CONTEXT.md
    const contextDiffs = await this.checkContextFiles(projectPath);
    diffs.push(...contextDiffs);

    return diffs;
  }

  /**
   * 检查 CAPABILITIES.md 与源码是否同步
   */
  private async checkCapabilitiesSync(projectPath: string): Promise<GovernanceDiff[]> {
    const diffs: GovernanceDiff[] = [];
    const capabilitiesPath = path.join(projectPath, 'CAPABILITIES.md');

    // 读取 CAPABILITIES.md
    let capContent: string;
    try {
      capContent = await fs.readFile(capabilitiesPath, 'utf-8');
    } catch {
      // CAPABILITIES.md 不存在
      return [];
    }

    // 解析表格中的文件路径
    const listedFiles = this.parseCapabilitiesFiles(capContent);

    // 如果没有表格，跳过
    if (listedFiles.length === 0) return [];

    // 扫描 src/ 中的实际文件
    const srcDir = path.join(projectPath, 'src');
    const actualFiles = await this.findSourceFiles(srcDir, projectPath);

    // 找出新增但未列出的文件
    const missing = actualFiles.filter(f => !listedFiles.includes(f));

    // 找出已列出但已删除的文件
    const removed = listedFiles.filter(f => !actualFiles.includes(f));

    if (missing.length > 0) {
      diffs.push({
        type: 'doc_mismatch',
        projectPath,
        details: {
          file: capabilitiesPath,
          current: capContent,
          expected: `新增文件未在 CAPABILITIES.md 中列出: ${missing.join(', ')}`,
          files: missing,
          context: { missing, listedFiles, actualFiles },
        },
      });
    }

    if (removed.length > 0) {
      diffs.push({
        type: 'doc_mismatch',
        projectPath,
        details: {
          file: capabilitiesPath,
          current: capContent,
          expected: `CAPABILITIES.md 中列出的文件已不存在: ${removed.join(', ')}`,
          files: removed,
          context: { removed, listedFiles, actualFiles },
        },
      });
    }

    return diffs;
  }

  /**
   * 检查 CONTEXT.md 文件
   */
  private async checkContextFiles(projectPath: string): Promise<GovernanceDiff[]> {
    const diffs: GovernanceDiff[] = [];
    const requiredDirs = await this.getRequiredContextDirs(projectPath);

    for (const dir of requiredDirs) {
      const contextPath = path.join(projectPath, dir, 'CONTEXT.md');

      try {
        const content = await fs.readFile(contextPath, 'utf-8');

        // 检查内容是否只是模板（没有实际填写）
        const isTemplate = content.includes('<!-- 本目录')
          || content.includes('<!-- 此文件描述');

        if (isTemplate) {
          diffs.push({
            type: 'context_outdated',
            projectPath,
            details: {
              file: contextPath,
              current: content,
              moduleName: dir,
              context: { reason: 'CONTEXT.md 仍为模板，未填写实际内容' },
            },
          });
        }
      } catch {
        // CONTEXT.md 不存在
        diffs.push({
          type: 'context_missing',
          projectPath,
          details: {
            file: contextPath,
            moduleName: dir,
            context: { requiredDir: dir },
          },
        });
      }
    }

    return diffs;
  }

  /**
   * 从治理配置获取需要 CONTEXT.md 的目录
   */
  private async getRequiredContextDirs(projectPath: string): Promise<string[]> {
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
      // 配置不存在
    }
    return [];
  }

  /**
   * 解析 CAPABILITIES.md 中的文件路径
   */
  private parseCapabilitiesFiles(content: string): string[] {
    const files: string[] = [];
    const tableRowRegex = /^\|[^|]+\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/gm;
    let match;
    while ((match = tableRowRegex.exec(content)) !== null) {
      files.push(match[1].trim());
    }
    return files;
  }

  /**
   * 递归查找源文件
   */
  private async findSourceFiles(dir: string, projectPath: string): Promise<string[]> {
    const results: string[] = [];
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      const entryPath = path.join(dir, entry);
      try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
          results.push(...await this.findSourceFiles(entryPath, projectPath));
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          results.push(path.relative(projectPath, entryPath));
        }
      } catch {
        // ignore
      }
    }
    return results;
  }
}

/**
 * 全局治理执行器单例
 */
export const governanceExecutor = new GovernanceExecutor();
