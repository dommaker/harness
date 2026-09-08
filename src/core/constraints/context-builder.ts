/**
 * 约束上下文构造器（工单 23）
 *
 * 从仓库状态（git diff / traces / 文档标记）推断 ConstraintContext：
 * 触发条件 + 各类证据标志。此前散落在 cli/commands/check.ts，
 * 迁入 core 供 CLI 与其他调用方共用。
 *
 * 架构评审 #87：本模块只做装配不做取证——git 证据一律经 git-evidence
 * adapter 取（缺省真 git adapter，调用方可注入与 checker 层同源的那一份），
 * 因此此处不再有 child_process / raw execSync。
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectSourceRoots } from '../../utils/detect-source-roots';
import { readJsonl } from '../../utils/jsonl';
import { DEFAULT_TRACE_FILE } from '../../types/trace';
import type { ExecutionTrace } from '../../types/trace';
import type { ConstraintContext, ConstraintTrigger } from '../../types/constraint';
import { createGitEvidence, splitFileNames, type GitEvidence } from './git-evidence';

/**
 * 检查文件所在目录是否在 git HEAD 中不存在（即新目录）
 *
 * headDirs 由 git-evidence adapter 取证（null = 命令失败，按惯例视所有目录为"新"）。
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
 *
 * 新目录判定所需的 HEAD 目录集经 git 证据 adapter 取（#87）：
 * 调用方注入即与 checker 层同一份证据，缺省走真 git adapter。
 */
export function detectTrigger(
  changedFiles: string[],
  options: {
    trigger?: ConstraintTrigger;
    projectPath?: string;
    evidence?: GitEvidence;
  }
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
  // 工单 18 的批量语义保留在 adapter 层：一次 ls-tree，且仅在有模块变更时才取证
  const headDirs = hasModuleChange
    ? (options.evidence ?? createGitEvidence(projectPath)).headDirs()
    : null;
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
    // 坏行策略：skip（原逐行 catch→false 语义不变）；只 parse 最近 20 行
    // 计数去向：豁免（harness#100）——布尔证据探测，坏行只会让证据变少（判定方向保守），
    // 消费面是 check 的 pass/fail 判定，没有可挂计数的输出位
    const { records } = readJsonl<ExecutionTrace>(traceFile, 'skip', { tail: 20 });
    return records.some(trace => trace.result === 'fail');
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
    // 坏行策略：skip（原逐行 catch→false 语义不变）；只 parse 最近 10 行
    // tail 在 parse 之前截断 → 坏行会占用尾部槽位（#82 裁决范围外的既有口径，本票不改）
    // 计数去向：豁免（harness#100）——同 detectFailingTest：布尔证据探测无计数输出位，
    // 坏行只会让证据变少
    const { records } = readJsonl<ExecutionTrace>(traceFile, 'skip', { tail: 10 });
    return records.some(trace => trace.result === 'pass');
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
 *
 * options.evidence（#87）：git 证据适配器。调用方（CLI check）注入同一实例给
 * checkConstraints，即可让 context-builder 与 checker 层共用同一证据来源。
 */
export async function buildConstraintContext(options: {
  projectPath?: string;
  staged: boolean;
  trigger?: ConstraintTrigger;
  evidence?: GitEvidence;
}): Promise<ConstraintContext> {
  const projectPath = options.projectPath || process.cwd();
  const evidence = options.evidence ?? createGitEvidence(projectPath);
  const changedFiles = splitFileNames(evidence.changedFileNames(options.staged));
  const inferred = detectTrigger(changedFiles, { trigger: options.trigger, projectPath, evidence });
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
  };
}
