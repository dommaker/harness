/**
 * harness spec-baseline-check 命令
 *
 * 验证 spec 文件的前置条件（Baseline / 前置条件）是否满足。
 * 纯代码操作，零 LLM 调用。
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { walkFiles } from '../../utils/file-walk';

export interface SpecBaselineCheckOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 输出 JSON 格式 */
  json?: boolean;
}

/** 前置条件验证结果 */
export interface PrerequisiteResult {
  /** 前置条件描述 */
  prerequisite: string;
  /** 是否满足 */
  satisfied: boolean;
  /** 证据 */
  evidence: string;
}

// ============================================
// 解析器
// ============================================

/**
 * 从 spec 内容中提取 Baseline/前置条件 section
 */
export function extractBaselineSection(content: string): string[] {
  const lines = content.split('\n');
  const prerequisites: string[] = [];

  // 查找 ## Baseline 或 ## 前置条件 section
  let inSection = false;
  let sectionLevel = 0;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      // 检查是否是目标 section
      if (/^(Baseline|前置条件|Prerequisites|Prereqs)$/i.test(title)) {
        inSection = true;
        sectionLevel = level;
        continue;
      }

      // 同级或更高级的标题结束 section
      if (inSection && level <= sectionLevel) {
        inSection = false;
        continue;
      }
    }

    // 在 section 中提取列表项
    if (inSection) {
      const listMatch = line.match(/^\s*[-*+]\s+(.+)/);
      if (listMatch) {
        prerequisites.push(listMatch[1].trim());
      }
      // 也支持编号列表
      const numberedMatch = line.match(/^\s*\d+\.\s+(.+)/);
      if (numberedMatch) {
        prerequisites.push(numberedMatch[1].trim());
      }
    }
  }

  return prerequisites;
}

// ============================================
// 命令级共享索引
// ============================================

/** package.json 依赖面的一次解析结果（失败态同样入库，不重试） */
type DependencySnapshot = { ok: true; deps: Record<string, string> } | { ok: false };

/**
 * 一次 spec-baseline-check 运行内的取数面（工单 #146，母票 #140 A 票）：
 * 全仓内容扫描、`package.json` 解析、同一落点的存在性探测各至多一遍，
 * 逐条前置只在索引上重放判定——此前是「前置条件数 × 关键词数 × 源文件数」的逐条重扫。
 *
 * 懒建：没有任何前置需要某类数据时，该类读取一次都不发生（口径与改前一致）。
 * 运行结束即弃，不跨命令、不扩 `RunEnv` 公共面（#140 triage 裁决 5）。
 */
interface BaselineIndex {
  /** 全仓源文件路径 → 内容；读失败的文件不入表（与改前逐文件 try/catch 跳过同义） */
  sourceContents(): Map<string, string>;
  /** package.json 的 dependencies + devDependencies 合并面 */
  dependencies(): DependencySnapshot;
  /** 绝对路径是否在世（同一落点一次运行内只 stat 一次） */
  exists(fullPath: string): boolean;
}

function createBaselineIndex(projectPath: string): BaselineIndex {
  let sources: Map<string, string> | undefined;
  let dependencySnapshot: DependencySnapshot | undefined;
  const stats = new Map<string, boolean>();

  return {
    sourceContents() {
      if (!sources) {
        const map = new Map<string, string>();
        // 遍历与内容读取各一次，供所有前置与关键词复用（工单 19 只收敛了遍历）
        for (const fullPath of walkFiles(projectPath, {
          skipDirs: ['node_modules', 'dist'],
          skipHidden: true,
          filter: (_name, filePath) => filePath.endsWith('.ts') || filePath.endsWith('.js'),
        })) {
          try {
            map.set(fullPath, fs.readFileSync(fullPath, 'utf-8'));
          } catch {
            /* skip */
          }
        }
        sources = map;
      }
      return sources;
    },
    dependencies() {
      if (!dependencySnapshot) {
        try {
          const pkgJson = JSON.parse(
            fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
          );
          dependencySnapshot = {
            ok: true,
            deps: { ...pkgJson.dependencies, ...pkgJson.devDependencies },
          };
        } catch {
          dependencySnapshot = { ok: false };
        }
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
// 验证器
// ============================================

/**
 * 检查文件/目录是否存在
 */
function checkFileExists(
  pattern: string,
  projectPath: string,
  index: BaselineIndex
): { exists: boolean; evidence: string } {
  // 提取路径引用（反引号中的路径、引号中的路径、或直接的路径模式）
  const pathPatterns = [
    /`([^`]+\.[a-z]+)`/g,           // `src/foo.ts`
    /["']([^"']+\.[a-z]+)["']/g,    // "src/foo.ts"
    /`([^`]+\/)`/g,                  // `src/foo/`
    /(\S+\/\S+\.[a-z]+)/g,          // src/foo.ts
  ];

  const paths: string[] = [];
  for (const p of pathPatterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(pattern)) !== null) {
      paths.push(m[1]);
    }
  }

  if (paths.length === 0) {
    return { exists: false, evidence: '无法从描述中提取路径' };
  }

  const found: string[] = [];
  const missing: string[] = [];

  for (const p of paths) {
    const fullPath = path.resolve(projectPath, p);
    if (index.exists(fullPath)) {
      found.push(p);
    } else {
      missing.push(p);
    }
  }

  if (missing.length === 0 && found.length > 0) {
    return { exists: true, evidence: `文件存在: ${found.join(', ')}` };
  }
  if (found.length > 0) {
    return { exists: false, evidence: `部分存在: ${found.join(', ')}; 缺失: ${missing.join(', ')}` };
  }
  return { exists: false, evidence: `文件不存在: ${missing.join(', ')}` };
}

/**
 * 检查代码中是否存在特定模式
 */
function checkCodePattern(pattern: string, index: BaselineIndex): { exists: boolean; evidence: string } {
  // 从描述中提取关键词
  const keywords: string[] = [];

  // 提取反引号中的代码
  const codePatterns = pattern.match(/`([^`]+)`/g);
  if (codePatterns) {
    for (const cp of codePatterns) {
      const inner = cp.slice(1, -1);
      if (inner.length >= 2) {
        keywords.push(inner);
      }
    }
  }

  // 提取 "implemented" / "exists" / "已实现" 等关键词后的内容
  const implMatch = pattern.match(/(?:implemented|exists|已实现|已完成|已存在)[\s:：]+(.+)/i);
  if (implMatch) {
    keywords.push(implMatch[1].trim());
  }

  if (keywords.length === 0) {
    return { exists: false, evidence: '无法从描述中提取搜索关键词' };
  }

  const found: string[] = [];
  const notFound: string[] = [];

  // 一次运行一份索引：全仓扫描与内容读取已在索引里发生一遍，这里只做匹配
  const sourceContents = index.sourceContents();

  for (const kw of keywords) {
    let count = 0;
    for (const content of sourceContents.values()) {
      if (content.includes(kw)) count++;
    }
    if (count > 0) {
      found.push(`${kw} (${count} files)`);
    } else {
      notFound.push(kw);
    }
  }

  if (notFound.length === 0 && found.length > 0) {
    return { exists: true, evidence: `代码中找到: ${found.join(', ')}` };
  }
  if (found.length > 0) {
    return { exists: false, evidence: `找到: ${found.join(', ')}; 未找到: ${notFound.join(', ')}` };
  }
  return { exists: false, evidence: `代码中未找到: ${notFound.join(', ')}` };
}

/**
 * 检查包依赖是否安装
 */
function checkDependency(
  pattern: string,
  projectPath: string,
  index: BaselineIndex
): { exists: boolean; evidence: string } {
  // 提取包名
  const pkgPatterns = [
    /`(@?[\w-]+\/[\w-]+)`/g,      // `@scope/pkg` or `pkg-name`
    /`([\w-]+)`/g,                  // `pkg`
    /install(?:ed)?\s+(\S+)/gi,    // installed pkg-name
  ];

  const packages: string[] = [];
  for (const p of pkgPatterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(pattern)) !== null) {
      const pkg = m[1];
      if (pkg.length >= 2 && !pkg.includes('/') && !pkg.includes('.')) {
        packages.push(pkg);
      }
    }
  }

  if (packages.length === 0) {
    return { exists: false, evidence: '无法从描述中提取包名' };
  }

  const found: string[] = [];
  const missing: string[] = [];

  // 一次运行只读解析一遍 package.json（失败态同样入库）
  const snapshot = index.dependencies();
  if (!snapshot.ok) {
    return { exists: false, evidence: '无法读取 package.json' };
  }
  const deps = snapshot.deps;

  for (const pkg of packages) {
    if (deps[pkg] || deps[`@types/${pkg}`]) {
      found.push(pkg);
    } else {
      // 检查 node_modules
      const nmPath = path.join(projectPath, 'node_modules', pkg);
      if (index.exists(nmPath)) {
        found.push(pkg);
      } else {
        missing.push(pkg);
      }
    }
  }

  if (missing.length === 0 && found.length > 0) {
    return { exists: true, evidence: `依赖已安装: ${found.join(', ')}` };
  }
  if (found.length > 0) {
    return { exists: false, evidence: `已安装: ${found.join(', ')}; 缺失: ${missing.join(', ')}` };
  }
  return { exists: false, evidence: `依赖缺失: ${missing.join(', ')}` };
}

/**
 * 综合验证一条前置条件（取数一律经命令级共享索引 `index`）
 */
function verifyPrerequisite(
  prereq: string,
  projectPath: string,
  index: BaselineIndex
): PrerequisiteResult {
  const lower = prereq.toLowerCase();

  // 路径/文件存在性检查
  if (lower.includes('文件') || lower.includes('file') || lower.includes('目录') || lower.includes('directory')
    || /`[^`]+\.[a-z]+`/.test(prereq) || /\//.test(prereq)) {
    const { exists, evidence } = checkFileExists(prereq, projectPath, index);
    if (exists || evidence.includes('文件不存在')) {
      return { prerequisite: prereq, satisfied: exists, evidence };
    }
  }

  // 依赖检查
  if (lower.includes('依赖') || lower.includes('install') || lower.includes('package') || lower.includes('npm')) {
    const { exists, evidence } = checkDependency(prereq, projectPath, index);
    return { prerequisite: prereq, satisfied: exists, evidence };
  }

  // 代码模式检查
  if (lower.includes('实现') || lower.includes('implement') || lower.includes('exist')
    || lower.includes('已') || lower.includes('必须')
    || /`[^`]+`/.test(prereq)) {
    const { exists, evidence } = checkCodePattern(prereq, index);
    return { prerequisite: prereq, satisfied: exists, evidence };
  }

  // 默认：无法自动验证
  return {
    prerequisite: prereq,
    satisfied: true,
    evidence: '无法自动验证（需人工确认）',
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
  const failed = results.filter(r => !r.satisfied);

  lines.push(chalk.bold(`  满足: ${satisfied}/${results.length}`));
  if (failed.length > 0) {
    lines.push(chalk.red(`  未满足: ${failed.length}\n`));
  } else {
    lines.push(chalk.green('  全部满足\n'));
  }

  for (const r of results) {
    const icon = r.satisfied ? chalk.green('✓') : chalk.red('✗');
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

  // 有未满足的前置条件时非零退出
  const failed = results.filter(r => !r.satisfied);
  if (failed.length > 0) {
    return {
      kind: 'fail',
      reason: `${failed.length} 条前置条件未满足: ${failed.map(f => f.prerequisite).join('; ')}`,
    };
  }
  return { kind: 'ok' };
}
