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
import { getGovernanceConfig, resolveContextFiles } from '../../project-config-loader';
import { FreshnessRunner, type FreshnessCheckResult } from '../doc-freshness/runner';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { reconcileCapabilities } from '../capabilities-reconcile';
import type { DocFreshnessCheck } from '../../../types/project-config';
import type { ConstraintCheck, CheckEnv } from './types';
import { formatEvidence } from './types';

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
 * CAPABILITIES.md 文件表新鲜度：登记的条目（文件与目录）必须仍存在（ADR-0009 口径从严）。
 * 判定逻辑统一走 capabilities-reconcile；多根查找支持不同项目的源码根
 * （harness=src/, studio=apps/api/src/ 等）。无表格（能力清单格式）时自然零幽灵。
 */
function findDeadCapabilityEntries(projectPath: string, env: CheckEnv): string[] {
  try {
    const capabilitiesPath = join(projectPath, 'CAPABILITIES.md');
    if (!existsSync(capabilitiesPath)) return [];
    const content = readFileSync(capabilitiesPath, 'utf-8');

    const sourceRoots = detectSourceRoots(projectPath);
    const population: string[] = [];
    for (const root of sourceRoots) {
      if (existsSync(join(projectPath, root))) population.push(...env.srcScan(root));
    }

    const verdict = reconcileCapabilities({
      content,
      populationFiles: population,
      sourceRoots,
      fileExists: (rel) => existsSync(join(projectPath, rel)),
    });
    return verdict.deadEntries;
  } catch {
    return [];
  }
}

/**
 * ADR-0001 存在性探测：项目是否存在任何 freshness 配置/检查目标。
 *
 * 判定信号（任一命中即视为采用了文档新鲜度约定）：
 * - 配置了 governance.doc_freshness.checks
 * - 配置了 governance.context_files 且约定有效（enabled + 非空 required_dirs）
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

  const governance = getGovernanceConfig(projectPath);
  if (governance?.doc_freshness?.checks && governance.doc_freshness.checks.length > 0) {
    return true;
  }

  return resolveContextFiles(projectPath).state === 'enabled';
}

export const docsFreshness: ConstraintCheck = {
  id: 'docs_freshness',
  async evaluate(env) {
    const projectPath = env.projectPath;

    // ADR-0001 存在性探测：项目无任何 freshness 配置/目标 → skip（不计 pass/fail）
    if (!hasFreshnessTargets(projectPath)) return 'skip';

    // Step 1: 文件表格式 — 登记的条目（文件+目录）是否仍存在（ADR-0009）
    const deadEntries = findDeadCapabilityEntries(projectPath, env);
    if (deadEntries.length > 0) {
      // 证据通道点名条目（harness#119）：此前是 console.error 侧信道（2026-08-08 studio
      // CI 4 连红时的临时办法），CLI 结构化输出与 trace 两头都拿不到，
      // 铁律拦截时用户只看到一句通用提示，basename 碰撞下无从定位
      return {
        pass: false,
        evidence: formatEvidence('CAPABILITIES.md 登记的条目不存在', deadEntries),
      };
    }

    // Step 2: 能力清单格式 + CLAUDE.md + CHANGELOG — 通过 FreshnessRunner
    try {
      const freshnessConfig = getGovernanceConfig(projectPath)?.doc_freshness;

      // context_files 三态统一口径（工单 84）：约定已立但无目标（enabled 但
      // required_dirs 缺失/空）→ skip，与 context_doc_sync 同构；不再静默放行
      const contextFiles = resolveContextFiles(projectPath);
      if (contextFiles.state === 'enabled-empty') return 'skip';
      const requiredDirs = contextFiles.state === 'enabled' ? contextFiles.dirs : undefined;

      const runner = new FreshnessRunner();
      let results: FreshnessCheckResult[];

      if (freshnessConfig?.checks && freshnessConfig.checks.length > 0) {
        results = runner.runAll(freshnessConfig, projectPath, { requiredDirs });
      } else {
        results = runner.runAll({ checks: getBuiltInDocFreshnessConfig() }, projectPath, { requiredDirs });
      }

      const failed = results.filter(r => !r.pass);
      if (failed.length > 0) {
        return {
          pass: false,
          evidence: formatEvidence(
            '文档新鲜度检查未通过',
            failed.map(r => `${r.label}: ${r.message ?? '未通过'}`)
          ),
        };
      }
    } catch {
      // FreshnessRunner 失败不影响整体
    }

    return true;
  },
};
