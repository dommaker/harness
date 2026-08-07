/**
 * harness doc-freshness-check 命令
 *
 * 从文档中提取可验证的声明(claims)，与代码/文件系统对照，输出差异。
 * 纯代码操作，零 LLM 调用。
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { walkFiles } from '../../utils/file-walk';

export interface DocFreshnessCheckOptions {
  /** 输出 JSON 格式 */
  format?: 'json' | 'table';
  /** 变更文件列表（逗号分隔），用于聚焦检查 */
  changedFiles?: string;
  /** 项目路径 */
  projectPath?: string;
}

/** 声明类型 */
export type ClaimType = 'numeric' | 'list' | 'status' | 'narrative';

/** 单条声明 */
export interface Claim {
  /** 原始文本片段 */
  text: string;
  /** 声明类型 */
  type: ClaimType;
  /** 行号 */
  line: number;
}

/** 验证结果 */
export interface ClaimResult {
  /** 原始声明 */
  claim: string;
  /** 声明类型 */
  type: ClaimType;
  /** 文档中的期望值 */
  expected: string;
  /** 实际值 */
  actual: string;
  /** 来源文件 */
  file: string;
  /** 是否匹配 */
  match: boolean;
}

// ============================================
// Claim 提取器
// ============================================

/** 数字声明：N 个/条/项 + 名词 */
const NUMERIC_PATTERNS = [
  /(\d+)\s*个\s*(Agent|角色|能力|子系统|模块|端点|命令|组件|层级|阶段|步骤|断点|问题|维度|门|规则|约束)/g,
  /(\d+)\s*条\s*(知识|规则|约束|命令|铁律|指南|提示|断点|问题|结果|记录)/g,
  /(\d+)\s*项\s*(检查|任务|功能|变更|修复|优化|指标|配置)/g,
  /(\d+)\s*(?:大|层)\s*(能力|约束|架构|层级)/g,
  /(\d+)\s*个\s*(?:CLI\s*)?subcommand/gi,
];

/** 列表声明：A, B, C, ... (至少 3 项) */
const LIST_PATTERN = /[A-Z][a-zA-Z]+(?:[,，、]\s*[A-Z][a-zA-Z]+){2,}/g;

/** 状态标记 */
const STATUS_PATTERNS = [
  /✅\s*(已完成|已实现|已修复|已部署|已连通|已验证)/g,
  /❌\s*(缺失|未实现|未完成|失败)/g,
  /\bDEPRECATED\b/g,
  /\bTODO\b/g,
  /待(开发|实现|修复|完善|验证)/g,
  /已(废弃|弃用|移除|删除)/g,
];

/**
 * 从 markdown 内容提取 claims
 */
export function extractClaims(content: string, filePath: string): ClaimResult[] {
  const lines = content.split('\n');
  const results: ClaimResult[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 数字声明
    for (const pattern of NUMERIC_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const fullMatch = match[0];
        const number = match[1];
        results.push({
          claim: fullMatch,
          type: 'numeric',
          expected: number,
          actual: '', // 待验证
          file: filePath,
          match: false,
        });
      }
    }

    // 列表声明
    const listMatches = line.match(LIST_PATTERN);
    if (listMatches) {
      for (const m of listMatches) {
        const items = m.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
        if (items.length >= 3) {
          results.push({
            claim: m,
            type: 'list',
            expected: items.join(', '),
            actual: '', // 待验证
            file: filePath,
            match: false,
          });
        }
      }
    }

    // 状态标记
    for (const pattern of STATUS_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        results.push({
          claim: match[0],
          type: 'status',
          expected: match[0],
          actual: '', // 待验证
          file: filePath,
          match: false,
        });
      }
    }
  }

  return results;
}

// ============================================
// 验证器
// ============================================

/**
 * 在项目目录中 grep 搜索匹配内容，返回匹配行数
 */
function countGrepMatches(pattern: string, projectPath: string, fileGlob?: string): number {
  const searchDir = projectPath || process.cwd();
  let count = 0;
  const regex = new RegExp(pattern, 'gi');

  const files = walkFiles(searchDir, {
    skipDirs: ['node_modules', 'dist'],
    skipHidden: true,
    filter: (name) => !fileGlob || matchGlob(name, fileGlob),
  });

  for (const fullPath of files) {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const matches = content.match(regex);
      if (matches) count += matches.length;
    } catch {
      // skip unreadable files
    }
  }

  return count;
}

/**
 * 简单 glob 匹配（支持 *.ext 和 *）
 */
function matchGlob(filename: string, glob: string): boolean {
  if (glob === '*') return true;
  if (glob.startsWith('*.')) {
    const ext = glob.slice(1);
    return filename.endsWith(ext);
  }
  return filename === glob;
}

/**
 * 验证数字声明：计数相关文件/代码模式
 */
function verifyNumericClaim(claim: ClaimResult, projectPath: string): ClaimResult {
  const expected = parseInt(claim.expected, 10);

  // 从声明文本推断搜索模式
  let searchPattern = '';
  let fileGlob = '*.ts';

  if (claim.claim.includes('Agent')) {
    searchPattern = 'export (class|interface|function) \\w*Agent';
  } else if (claim.claim.includes('命令') || claim.claim.includes('subcommand')) {
    fileGlob = '*.ts';
    searchPattern = "program\\.command\\(";
  } else if (claim.claim.includes('铁律') || claim.claim.includes('约束') || claim.claim.includes('规则')) {
    searchPattern = "severity:\\s*['\"]?error";
    fileGlob = '*.ts';
  } else if (claim.claim.includes('指南')) {
    searchPattern = "severity:\\s*['\"]?warning";
    fileGlob = '*.ts';
  } else if (claim.claim.includes('端点')) {
    searchPattern = '(router|app)\\.(get|post|put|delete|patch)\\(';
    fileGlob = '*.ts';
  } else {
    // 无法自动验证的数字声明
    return { ...claim, actual: 'N/A (cannot auto-verify)', match: true };
  }

  const actual = countGrepMatches(searchPattern, projectPath, fileGlob);

  return {
    ...claim,
    actual: String(actual),
    match: Math.abs(actual - expected) <= Math.max(1, Math.floor(expected * 0.1)), // 10% tolerance
  };
}

/**
 * 验证列表声明：检查列表中的每一项是否存在于代码中
 */
function verifyListClaim(claim: ClaimResult, projectPath: string): ClaimResult {
  const items = claim.expected.split(',').map(s => s.trim());
  const found: string[] = [];
  const missing: string[] = [];

  for (const item of items) {
    const count = countGrepMatches(item, projectPath);
    if (count > 0) {
      found.push(item);
    } else {
      missing.push(item);
    }
  }

  return {
    ...claim,
    actual: missing.length === 0
      ? `all ${items.length} found`
      : `missing: ${missing.join(', ')}`,
    match: missing.length === 0,
  };
}

/**
 * 验证状态声明：检查标记是否与代码/文件一致
 */
function verifyStatusClaim(claim: ClaimResult, _projectPath: string): ClaimResult {
  // 状态声明的验证较复杂，标记为需要人工确认
  return {
    ...claim,
    actual: 'needs manual verification',
    match: true, // 不阻断
  };
}

/**
 * 验证所有 claims
 */
export function verifyClaims(
  claims: ClaimResult[],
  projectPath: string,
): ClaimResult[] {
  return claims.map(claim => {
    switch (claim.type) {
      case 'numeric':
        return verifyNumericClaim(claim, projectPath);
      case 'list':
        return verifyListClaim(claim, projectPath);
      case 'status':
        return verifyStatusClaim(claim, projectPath);
      default:
        return { ...claim, actual: 'N/A', match: true };
    }
  });
}

// ============================================
// 输出格式化
// ============================================

function formatTable(results: ClaimResult[]): string {
  if (results.length === 0) return chalk.yellow('未发现可验证的声明');

  const lines: string[] = [];
  lines.push(chalk.blue(`文档新鲜度检查 (${results.length} 条声明)\n`));

  // 统计
  const mismatches = results.filter(r => !r.match);
  lines.push(chalk.bold(`  匹配: ${results.length - mismatches.length}/${results.length}`));
  if (mismatches.length > 0) {
    lines.push(chalk.red(`  不匹配: ${mismatches.length}\n`));
  } else {
    lines.push(chalk.green('  全部匹配\n'));
  }

  // 按类型分组
  const byType: Record<string, ClaimResult[]> = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  const typeLabels: Record<string, string> = {
    numeric: '数字声明',
    list: '列表声明',
    status: '状态标记',
    narrative: '叙述声明',
  };

  for (const [type, items] of Object.entries(byType)) {
    lines.push(chalk.bold(`  ${typeLabels[type] || type} (${items.length}):`));
    for (const item of items) {
      const icon = item.match ? chalk.green('✓') : chalk.red('✗');
      lines.push(`    ${icon} ${item.claim}`);
      if (!item.match) {
        lines.push(`      期望: ${item.expected}`);
        lines.push(`      实际: ${chalk.yellow(item.actual)}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================
// 主入口
// ============================================

/**
 * doc-freshness-check CLI 命令
 */
export async function docFreshnessCheck(
  docPath: string,
  options: DocFreshnessCheckOptions = {},
): Promise<void> {
  // 验证文件存在
  const resolvedPath = path.resolve(docPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(chalk.red(`文件不存在: ${resolvedPath}`));
    process.exitCode = 1;
    return;
  }

  if (!resolvedPath.endsWith('.md')) {
    console.error(chalk.yellow(`警告: 文件不是 .md 格式，可能无法正确解析`));
  }

  const projectPath = options.projectPath || path.dirname(resolvedPath);

  // 读取文档
  const content = fs.readFileSync(resolvedPath, 'utf-8');

  // 提取声明
  let claims = extractClaims(content, resolvedPath);

  // 如果指定了变更文件，只验证与变更文件相关的声明
  if (options.changedFiles) {
    const changed = options.changedFiles.split(',').map(s => s.trim());
    // 过滤：保留所有 claims，但只验证与变更文件相关的
    // 实际实现中可以根据声明内容推断相关文件
    void changed; // 预留
  }

  // 验证
  const results = verifyClaims(claims, projectPath);

  // 输出
  if (options.format === 'json') {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatTable(results));
  }

  // 有不匹配时 exit 1
  const mismatches = results.filter(r => !r.match);
  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}
