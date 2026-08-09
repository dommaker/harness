/**
 * 约束上下文构造器（工单 23）
 *
 * 从仓库状态（git diff / traces / 文档标记）推断 ConstraintContext：
 * 触发条件 + 各类证据标志。此前散落在 cli/commands/check.ts，
 * 迁入 core 供 CLI 与其他调用方共用。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { execAsync } from '../../utils/exec';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
import type { ConstraintContext, ConstraintTrigger } from '../../types/constraint';

/**
 * 从 git diff 获取变更的文件
 */
export async function getChangedFiles(staged: boolean, projectPath?: string): Promise<string[]> {
  try {
    const command = staged ? 'git diff --cached --name-only' : 'git diff --name-only';
    const { stdout } = projectPath
      ? await execAsync(command, { cwd: projectPath })
      : await execAsync(command);
    return String(stdout).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 一次性列出 HEAD 中存在的所有目录（工单 18：替代逐文件 git ls-tree）
 *
 * 返回 null 表示命令失败（按惯例视所有目录为"新"）。
 */
export function listHeadDirs(projectPath: string): Set<string> | null {
  try {
    const output = execSync('git ls-tree -r --name-only HEAD', { cwd: projectPath, stdio: 'pipe', encoding: 'utf-8' });
    const dirs = new Set<string>();
    for (const file of String(output).split('\n')) {
      if (!file) continue;
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }
    return dirs;
  } catch {
    return null;
  }
}

/**
 * 检查文件所在目录是否在 git HEAD 中不存在（即新目录）
 */
export function isNewDirectory(headDirs: Set<string> | null, filePath: string): boolean {
  if (headDirs === null) return true; // 命令失败 = 假定为新
  return !headDirs.has(path.dirname(filePath));
}

/**
 * 代码文件扩展名（ADR-0001：code_implementation 推断信号）
 *
 * 纯文档/配置（.md/.json/.yml 等）不算代码变更。
 */
const CODE_FILE_REGEX = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|vue|svelte)$/i;

/**
 * 检测触发条件
 *
 * ADR-0001：变更包含代码文件时，在主推断之外附加 code_implementation
 * （返回数组 [主推断, 'code_implementation']；主推断逻辑保持不变）。
 */
export function detectTrigger(
  changedFiles: string[],
  options: { trigger?: ConstraintTrigger; projectPath?: string }
): ConstraintTrigger | ConstraintTrigger[] {
  if (options.trigger) return options.trigger;

  // 根据变更文件推断触发条件
  const hasTestChange = changedFiles.some(f =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')
  );
  // pre-commit 场景下变更含代码文件 → 附加 code_implementation 推断
  const hasCodeChange = changedFiles.some(f => CODE_FILE_REGEX.test(f));
  const projectPath = options.projectPath || process.cwd();
  const sourceRoots = detectSourceRoots(projectPath);
  const hasModuleChange = changedFiles.some(f =>
    sourceRoots.some(root => f.startsWith(root + '/') || f.startsWith(root + '\\')) && !f.includes('__tests__')
  );
  const headDirs = hasModuleChange ? listHeadDirs(projectPath) : null;
  const hasModuleCreation = changedFiles.some(f =>
    sourceRoots.some(root => f.startsWith(root + '/') || f.startsWith(root + '\\')) &&
    isNewDirectory(headDirs, f)
  );

  let primary: ConstraintTrigger;
  if (hasTestChange && !hasModuleChange) primary = 'test_creation';
  else if (hasModuleCreation) primary = 'module_creation';
  else if (hasModuleChange) primary = 'module_modification';
  else primary = 'file_modification';

  return hasCodeChange ? [primary, 'code_implementation'] : primary;
}

/**
 * 检测是否有失败的测试记录
 * 扫描 trace 文件（DEFAULT_TRACE_FILE）中最近的记录
 */
export async function detectFailingTest(projectPath: string): Promise<boolean> {
  try {
    const traceFile = path.join(projectPath, DEFAULT_TRACE_FILE);
    if (!fs.existsSync(traceFile)) return false;

    const content = fs.readFileSync(traceFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return false;

    // 检查最近 20 条记录是否有 fail
    const recent = lines.slice(-20);
    return recent.some(line => {
      try {
        const trace = JSON.parse(line);
        return trace.result === 'fail';
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * 检测是否有根因分析文档
 * 检查 ROOT_CAUSE.md、.harness/diagnoses/、或 git commit 消息
 */
export function detectRootCauseInvestigation(projectPath: string): boolean {
  // 检查 ROOT_CAUSE.md
  if (fs.existsSync(path.join(projectPath, 'ROOT_CAUSE.md'))) return true;

  // 检查 .harness/diagnoses/ 目录
  const diagnosesDir = path.join(projectPath, '.harness', 'diagnoses');
  if (fs.existsSync(diagnosesDir)) {
    try {
      const files = fs.readdirSync(diagnosesDir);
      if (files.length > 0) return true;
    } catch {
      // ignore
    }
  }

  return false;
}

/**
 * 检测是否有验证证据
 * 检查 trace 文件（DEFAULT_TRACE_FILE）中最近的成功验证记录
 */
export async function detectVerificationEvidence(projectPath: string): Promise<boolean> {
  try {
    const traceFile = path.join(projectPath, DEFAULT_TRACE_FILE);
    if (!fs.existsSync(traceFile)) return false;

    const content = fs.readFileSync(traceFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return false;

    // 检查最近 10 条记录是否有 pass
    const recent = lines.slice(-10);
    return recent.some(line => {
      try {
        const trace = JSON.parse(line);
        return trace.result === 'pass';
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * 检测是否有需求来源
 * 检查 CLAUDE.md、README.md、specs/、docs/specs/ 等
 */
export function detectRequirement(projectPath: string): boolean {
  // Check for CLAUDE.md with HARNESS_CONSTRAINTS section
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    try {
      const content = fs.readFileSync(claudeMdPath, 'utf-8');
      if (content.includes('HARNESS_CONSTRAINTS')) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  const indicators = [
    'README.md',
    'specs',
    'docs/specs',
    '.specs',
  ];
  return indicators.some(f => fs.existsSync(path.join(projectPath, f)));
}

/**
 * 检测是否在 git worktree 中
 */
export function detectWorktree(projectPath: string): boolean {
  try {
    const gitDir = path.join(projectPath, '.git');
    if (fs.existsSync(gitDir)) {
      const content = fs.readFileSync(gitDir, 'utf-8');
      // 实际 worktree 的 .git 是文件（指向主 repo），不是目录
      return content.startsWith('gitdir:');
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * 检测是否有复用检查
 * 检查 .harness/reuse/ 目录或相关文档
 */
export function detectReuseCheck(projectPath: string): boolean {
  const reuseDir = path.join(projectPath, '.harness', 'reuse');
  if (fs.existsSync(reuseDir)) {
    try {
      const files = fs.readdirSync(reuseDir);
      if (files.length > 0) return true;
    } catch {
      // ignore
    }
  }

  return false;
}

/**
 * 构建约束上下文：变更文件 + 触发条件推断 + 证据标志检测
 */
export async function buildConstraintContext(options: {
  projectPath?: string;
  staged: boolean;
  trigger?: ConstraintTrigger;
}): Promise<ConstraintContext> {
  const projectPath = options.projectPath || process.cwd();
  const changedFiles = await getChangedFiles(options.staged, options.projectPath);
  const inferred = detectTrigger(changedFiles, { trigger: options.trigger, projectPath });
  const triggers = Array.isArray(inferred) ? inferred : [inferred];

  return {
    operation: triggers[0],
    extraTriggers: triggers.slice(1),
    projectPath,
    changedFiles,
    hasTest: changedFiles.some(f => f.includes('.test.') || f.includes('.spec.')),
    hasFailingTest: await detectFailingTest(projectPath),
    hasRootCauseInvestigation: detectRootCauseInvestigation(projectPath),
    hasVerificationEvidence: await detectVerificationEvidence(projectPath),
    hasReuseCheck: detectReuseCheck(projectPath),
    hasRequirement: detectRequirement(projectPath),
    hasWorktree: detectWorktree(projectPath),
  };
}
