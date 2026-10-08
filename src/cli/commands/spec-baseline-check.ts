/**
 * harness spec-baseline-check 命令
 *
 * 验证 spec 文件的前置条件（Baseline / 前置条件）是否满足。
 * 纯代码操作，零 LLM 调用。
 *
 * ADR-0020/0025 格局（ADR-0040 Phase 3）：判定纯函数（extractBaselineSection /
 * verifyPrerequisite / PrerequisiteResult / BaselineIndex 取数面接口）住
 * `core/spec/baseline-check`；本模块只剩采集（BaselineIndex 实现 = 全仓扫描 /
 * package.json 解析 / stat 探测）与输出（表格 / JSON / 退出码）。
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { walkFiles } from '../../utils/file-walk';
import { readPackageJson } from '../../utils/package-json';
import {
  extractBaselineSection,
  verifyPrerequisite,
  type BaselineIndex,
  type DependencySnapshot,
  type PrerequisiteResult,
} from '../../core/spec/baseline-check';

export type { PrerequisiteResult } from '../../core/spec/baseline-check';
export { extractBaselineSection } from '../../core/spec/baseline-check';

export interface SpecBaselineCheckOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 输出 JSON 格式 */
  json?: boolean;
}

// ============================================
// 命令级共享索引（采集）
// ============================================

/**
 * 共享索引的驻留上限（#162，统一复审遗留项 3）：
 * #146 把全仓源文件内容常驻一个 Map，排除面只有 node_modules/dist/隐藏目录与后缀，
 * 无任何容量上限——峰值内存由 O(单文件) 变 O(全仓源码)，大 monorepo 会承担这个峰值。
 * 超出任一上限即放弃驻留、回落逐文件流式读（峰值回到 O(单文件)），
 * 正常规模仓仍保留「一次遍历」收益。
 */
export const SOURCE_INDEX_MAX_ENTRIES = 5000;
export const SOURCE_INDEX_MAX_BYTES = 64 * 1024 * 1024;

/** 驻留上限（测试可注入小值走回落路径；生产一律缺省常量） */
export interface SourceIndexLimits {
  maxEntries: number;
  maxBytes: number;
}

export function createBaselineIndex(
  projectPath: string,
  limits: SourceIndexLimits = { maxEntries: SOURCE_INDEX_MAX_ENTRIES, maxBytes: SOURCE_INDEX_MAX_BYTES }
): BaselineIndex {
  /** undefined = 未建（懒建）；null = 超上限放弃驻留（回落流式读） */
  let sources: Map<string, string> | null | undefined;
  let dependencySnapshot: DependencySnapshot | undefined;
  const stats = new Map<string, boolean>();

  const walkSourceFiles = () =>
    walkFiles(projectPath, {
      skipDirs: ['node_modules', 'dist'],
      skipHidden: true,
      filter: (_name, filePath) => filePath.endsWith('.ts') || filePath.endsWith('.js'),
    });

  /** 遍历与内容读取各一次建驻留索引；超任一上限即弃表返回 null（#162 驻留上界） */
  function buildIndex(): Map<string, string> | null {
    const map = new Map<string, string>();
    let totalBytes = 0;
    for (const fullPath of walkSourceFiles()) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        map.set(fullPath, content);
        totalBytes += Buffer.byteLength(content);
        if (map.size > limits.maxEntries || totalBytes > limits.maxBytes) {
          return null; // 已读内容随 map 一起弃，驻留峰值 ≤ 上限
        }
      } catch {
        /* skip：读失败的文件不入表（与改前逐文件 try/catch 跳过同义） */
      }
    }
    return map;
  }

  return {
    countFilesContaining(keyword) {
      if (sources === undefined) sources = buildIndex();
      if (sources !== null) {
        let count = 0;
        for (const content of sources.values()) {
          if (content.includes(keyword)) count++;
        }
        return count;
      }
      // 回落：逐文件流式读、读完即弃，驻留 O(单文件)（改前逐关键词重读同形）
      let count = 0;
      for (const fullPath of walkSourceFiles()) {
        try {
          if (fs.readFileSync(fullPath, 'utf-8').includes(keyword)) count++;
        } catch {
          /* skip */
        }
      }
      return count;
    },
    dependencies() {
      if (!dependencySnapshot) {
        // 缺失 = 合法空（ok:false）；损坏 = readPackageJson 抛出（fail-fast，不入库不重试）
        const pkgJson = readPackageJson(projectPath);
        dependencySnapshot = pkgJson
          ? { ok: true, deps: { ...pkgJson.dependencies, ...pkgJson.devDependencies } }
          : { ok: false };
      }
      return dependencySnapshot;
    },
    exists(fullPath) {
      let hit = stats.get(fullPath);
      if (hit === undefined) {
        hit = fs.existsSync(fullPath);
        stats.set(fullPath, hit);
      }
      return hit;
    },
  };
}

// ============================================
// 输出格式化
// ============================================

function formatTable(results: PrerequisiteResult[]): string {
  if (results.length === 0) return chalk.yellow('未找到 Baseline / 前置条件 section');

  const lines: string[] = [];
  lines.push(chalk.blue(`前置条件检查 (${results.length} 条)\n`));

  const satisfied = results.filter(r => r.satisfied).length;
  const undetermined = results.filter(r => r.undetermined);
  const failed = results.filter(r => !r.satisfied && !r.undetermined);

  lines.push(chalk.bold(`  满足: ${satisfied}/${results.length}`));
  if (failed.length > 0) {
    lines.push(chalk.red(`  未满足: ${failed.length}`));
  }
  if (undetermined.length > 0) {
    lines.push(chalk.yellow(`  无法判定: ${undetermined.length}（按未满足处理）`));
  }
  if (failed.length === 0 && undetermined.length === 0) {
    lines.push(chalk.green('  全部满足'));
  }
  lines.push('');

  for (const r of results) {
    const icon = r.satisfied ? chalk.green('✓') : r.undetermined ? chalk.yellow('?') : chalk.red('✗');
    lines.push(`  ${icon} ${r.prerequisite}`);
    if (!r.satisfied) {
      lines.push(`    ${chalk.yellow(r.evidence)}`);
    }
  }

  return lines.join('\n');
}

// ============================================
// 主入口
// ============================================

/**
 * spec-baseline-check CLI 命令
 */
export async function specBaselineCheck(
  specPath: string,
  options: SpecBaselineCheckOptions = {},
  io: CommandIO = processIO,
): Promise<CommandResult> {
  // 验证文件存在
  const resolvedPath = path.resolve(specPath);
  if (!fs.existsSync(resolvedPath)) {
    logError(io, chalk.red(`文件不存在: ${resolvedPath}`));
    return { kind: 'usage-error', reason: `spec 文件不存在: ${resolvedPath}` };
  }

  const projectPath = options.projectPath || path.dirname(resolvedPath);

  // 读取 spec
  const content = fs.readFileSync(resolvedPath, 'utf-8');

  // 提取前置条件
  const prerequisites = extractBaselineSection(content);

  if (prerequisites.length === 0) {
    if (options.json) {
      log(io, JSON.stringify({ prerequisites: [], message: '未找到 Baseline / 前置条件 section' }, null, 2));
    } else {
      log(io, chalk.yellow('未找到 ## Baseline 或 ## 前置条件 section'));
    }
    return { kind: 'skip', reason: '未找到 Baseline / 前置条件 section，无可判定项' };
  }

  // 验证每条前置条件（全仓扫描与 package.json 解析在本次运行内各至多一遍）
  const index = createBaselineIndex(projectPath);
  const results = prerequisites.map(p => verifyPrerequisite(p, projectPath, index));

  // 输出
  if (options.json) {
    log(io, JSON.stringify(results, null, 2));
  } else {
    log(io, formatTable(results));
  }

  // 有未满足或无法判定的前置条件时非零退出（无法判定不假绿放过）
  const failed = results.filter(r => !r.satisfied);
  if (failed.length > 0) {
    const undeterminedCount = results.filter(r => r.undetermined).length;
    const suffix = undeterminedCount > 0 ? `（含 ${undeterminedCount} 条无法判定）` : '';
    return {
      kind: 'fail',
      reason: `${failed.length} 条前置条件未满足${suffix}: ${failed.map(f => f.prerequisite).join('; ')}`,
    };
  }
  return { kind: 'ok' };
}
