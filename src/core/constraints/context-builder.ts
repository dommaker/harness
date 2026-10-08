/**
 * 约束上下文构造器（工单 23）
 *
 * 从仓库状态（git diff）推断 ConstraintContext：触发条件 + 变更文件清单。
 * 此前散落在 cli/commands/check.ts，迁入 core 供 CLI 与其他调用方共用。
 *
 * 架构评审 #87：本模块只做装配不做取证——git 证据一律经 git-evidence
 * adapter 取（缺省真 git adapter，调用方可注入与 checker 层同源的那一份），
 * 因此此处不再有 child_process / raw execSync。
 *
 * ADR-0023：源码根探测经运行级观察面 `RunEnv` 取，缺省自造一份 env，
 * 调用方（CLI check）注入即全 run 共用。
 */

import * as path from 'path';
import { createRunEnv, type RunEnv } from './run-env';
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
    /** 运行级观察面（ADR-0023）：注入即与其余消费方共用同一份源根探测 */
    runEnv?: RunEnv;
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
  const sourceRoots = (options.runEnv ?? createRunEnv(projectPath)).sourceRoots();
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
 * 构建约束上下文：变更文件 + 触发条件推断
 *
 * options.evidence（#87）：git 证据适配器。调用方（CLI check）注入同一实例给
 * checkConstraints，即可让 context-builder 与 checker 层共用同一证据来源。
 * options.runEnv（ADR-0023）：运行级观察面。注入即本函数内的源根探测
 * 与其余消费方共用同一份读取，缺省自造一份（只服务本次调用）。
 */
export function buildConstraintContext(options: {
  projectPath?: string;
  staged: boolean;
  trigger?: ConstraintTrigger;
  evidence?: GitEvidence;
  runEnv?: RunEnv;
}): ConstraintContext {
  const projectPath = options.projectPath || process.cwd();
  const evidence = options.evidence ?? createGitEvidence(projectPath);
  const changedFiles = splitFileNames(evidence.changedFileNames(options.staged));
  const inferred = detectTrigger(changedFiles, {
    trigger: options.trigger,
    projectPath,
    evidence,
    runEnv: options.runEnv,
  });
  const triggers = Array.isArray(inferred) ? inferred : [inferred];

  return {
    operation: triggers[0],
    extraTriggers: triggers.slice(1),
    projectPath,
    changedFiles,
  };
}
