/**
 * docs_freshness：CAPABILITIES.md 文件表 + 能力清单格式 + CLAUDE.md + CHANGELOG（工单 21）
 *
 * 0. 存在性探测（ADR-0001）：项目无任何 freshness 配置/目标时 skip，不计 pass/fail
 * 1. 文件表格式：CAPABILITIES.md 中列出的文件必须仍存在（防过期引用）
 * 2. 能力清单格式：FreshnessRunner 配置驱动检查
 * 3. 无配置时注入内置默认配置（等价旧硬编码行为）
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadRawProjectConfig } from '../../project-config-loader';
import { FreshnessRunner, type FreshnessCheckResult } from '../doc-freshness/runner';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import type { DocFreshnessConfig, DocFreshnessCheck } from '../../../types/project-config';
import type { ConstraintCheck } from './types';

/**
 * 内置默认文档新鲜度检查配置
 *
 * 等价旧硬编码行为；仅当项目未提供 governance.doc_freshness 配置时使用。
 */
function getBuiltInDocFreshnessConfig(): DocFreshnessCheck[] {
  return [
    // CONTEXT.md 存在性 — key directories must have CONTEXT.md
    { type: 'context_docs' },
    // CHANGELOG 版本 vs package.json 版本 — prevents version drift
    { type: 'changelog_version' },
  ];
}

/**
 * CAPABILITIES.md 文件表新鲜度：列出的文件路径必须仍存在。
 * 多根查找：支持不同项目的源码根（harness=src/, studio=apps/api/src/ 等）。
 * 无表格行（能力清单格式）时跳过。
 */
function checkCapabilitiesFreshness(projectPath: string): boolean {
  try {
    const capabilitiesPath = join(projectPath, 'CAPABILITIES.md');
    if (!existsSync(capabilitiesPath)) return true;
    const content = readFileSync(capabilitiesPath, 'utf-8');

    const listedFiles: string[] = [];
    const tableRowRegex = /^\|[^|]+\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/gm;
    let match;
    while ((match = tableRowRegex.exec(content)) !== null) {
      listedFiles.push(match[1].trim());
    }

    if (listedFiles.length === 0) return true;

    const sourceRoots = detectSourceRoots(projectPath);
    const fileExists = (file: string): boolean => {
      if (existsSync(join(projectPath, file))) return true;
      for (const root of sourceRoots) {
        if (existsSync(join(projectPath, root, file))) return true;
      }
      return false;
    };

    const missing = listedFiles.filter(f => !fileExists(f));
    if (missing.length > 0) {
      // 报出具体文件名：此前只返回 false，CLI 只能打印通用提示，
      // 幽灵条目 basename 碰撞时 sync-docs 也不剔除，用户无从定位（2026-08-08 studio CI 4 连红）
      console.error(`[docs_freshness] CAPABILITIES.md 列出的文件不存在: ${missing.join(', ')}`);
      return false;
    }

    return true;
  } catch {
    return true;
  }
}

/**
 * ADR-0001 存在性探测：项目是否存在任何 freshness 配置/检查目标。
 *
 * 判定信号（任一命中即视为采用了文档新鲜度约定）：
 * - 配置了 governance.doc_freshness.checks
 * - 配置了 governance.context_files（enabled + 非空 required_dirs）
 * - 项目根存在 CAPABILITIES.md
 * - 项目根存在 CHANGELOG.md / CHANGELOG
 *
 * 全部缺失 → 项目未采用该约定，调用方应 skip 而非评估内置默认配置。
 */
function hasFreshnessTargets(projectPath: string): boolean {
  if (existsSync(join(projectPath, 'CAPABILITIES.md'))) return true;
  if (existsSync(join(projectPath, 'CHANGELOG.md')) || existsSync(join(projectPath, 'CHANGELOG'))) {
    return true;
  }

  try {
    const raw = loadRawProjectConfig(projectPath);
    const governance = raw?.governance as Record<string, unknown> | undefined;

    const freshnessConfig = governance?.doc_freshness as DocFreshnessConfig | undefined;
    if (freshnessConfig?.checks && freshnessConfig.checks.length > 0) return true;

    const contextFiles = governance?.context_files as Record<string, unknown> | undefined;
    if (
      contextFiles?.enabled &&
      Array.isArray(contextFiles.required_dirs) &&
      (contextFiles.required_dirs as string[]).length > 0
    ) {
      return true;
    }
  } catch {
    // 配置不可读视为无配置
  }

  return false;
}

export const docsFreshness: ConstraintCheck = {
  id: 'docs_freshness',
  async evaluate(env) {
    const projectPath = env.projectPath;

    // ADR-0001 存在性探测：项目无任何 freshness 配置/目标 → skip（不计 pass/fail）
    if (!hasFreshnessTargets(projectPath)) return 'skip';

    // Step 1: 文件表格式 — 检查列出的文件是否还存在
    if (!checkCapabilitiesFreshness(projectPath)) return false;

    // Step 2: 能力清单格式 + CLAUDE.md + CHANGELOG — 通过 FreshnessRunner
    try {
      let freshnessConfig: DocFreshnessConfig | undefined;
      let requiredDirs: string[] | undefined;

      try {
        const raw = loadRawProjectConfig(projectPath);
        const governance = raw?.governance as Record<string, unknown> | undefined;
        freshnessConfig = governance?.doc_freshness as DocFreshnessConfig | undefined;

        const contextFiles = governance?.context_files as Record<string, unknown> | undefined;
        if (contextFiles?.enabled && Array.isArray(contextFiles.required_dirs)) {
          requiredDirs = contextFiles.required_dirs as string[];
        }
      } catch {
        // 配置解析失败，使用默认
      }

      const runner = new FreshnessRunner();
      let results: FreshnessCheckResult[];

      if (freshnessConfig?.checks && freshnessConfig.checks.length > 0) {
        results = runner.runAll(freshnessConfig, projectPath, { requiredDirs });
      } else {
        results = runner.runAll({ checks: getBuiltInDocFreshnessConfig() }, projectPath, { requiredDirs });
      }

      if (!results.every(r => r.pass)) return false;
    } catch {
      // FreshnessRunner 失败不影响整体
    }

    return true;
  },
};
