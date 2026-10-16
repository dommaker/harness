/**
 * doc_dir_check 检查（自 runner.ts 拆出，重构班次 3 Phase 4）
 *
 * 文档章节登记的目录 ↔ 磁盘实际目录双向对照（含根目录推断）。
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { detectSourceRoots } from '../../../utils/detect-source-roots';
import { escapeRegExp } from '../../../utils/text';
import { DEFAULT_SKIP_DIRS } from '../../../utils/file-walk';
import type { DocDirCheck } from '../../../types/project-config';
import type { FreshnessCheckResult, RunContext } from './runner';

export function checkDocDir(
  check: DocDirCheck,
  ctx: RunContext
): FreshnessCheckResult {
  // fail-fast：doc 缺失/章节缺失/无目录引用是「无检查对象」按显式分支跳过；
  // 读失败、正则构造错误等真异常直接抛（原整体 catch 成静默 pass，harness#119 同族）
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
    `## ${escapeRegExp(check.section)}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n---|$)`
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
    const rootDirs = inferRootDirs(docDirs, ctx);
    const excludeSet = new Set(check.exclude || DEFAULT_SKIP_DIRS);

    for (const rootDir of rootDirs) {
      const absRoot = join(ctx.projectPath, rootDir);
      if (!existsSync(absRoot)) continue;

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
}

/**
 * 从文档目录集合推断要扫描的根目录
 * 例如 ["src/core", "src/cli/commands"] → ["src"]
 */
function inferRootDirs(docDirs: Set<string>, ctx: RunContext): string[] {
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

  if (merged.size > 0) return [...merged];
  // 兜底 = 文档一个目录条目都没登记：按项目实际源码根全量比对（删掉它等于静默放行空文档）。
  // 取根优先用调用方注入的懒取 provider（与本 run 其余消费方共用一次探测，ADR-0023 决策 4）
  return ctx.sourceRoots ? ctx.sourceRoots() : detectSourceRoots(ctx.projectPath);
}
