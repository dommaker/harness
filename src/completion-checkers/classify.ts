/**
 * commit 文件分类（tdd-chain 与 phase-format 共享同一份分类结果，Q4 定稿）
 *
 * - 纯非代码（全部命中 noncode_globs）与纯测试（全部命中 test_globs）commit 天然免检
 * - 混合 commit 只要触到代码文件即需走引用链
 * - 空文件清单按免检处理
 */

import type { CommitInput, CompletionCheckersConfig } from './types';
import { DEFAULT_NONCODE_GLOBS, DEFAULT_TEST_GLOBS, matchAnyGlob } from './glob-match';

/** 单 commit 文件分类结果 */
export interface CommitFileClassification {
  /** 无代码文件（纯测试 / 纯非代码 / 空清单）→ 天然免检 */
  exempt: boolean;
  /** 文件清单命中 test_globs（被引 commit 须满足） */
  hasTests: boolean;
}

/** 从配置取 glob（缺省落默认） */
export function resolveGlobs(config: CompletionCheckersConfig): { testGlobs: string[]; noncodeGlobs: string[] } {
  return {
    testGlobs: config.testGlobs ?? DEFAULT_TEST_GLOBS,
    noncodeGlobs: config.noncodeGlobs ?? DEFAULT_NONCODE_GLOBS,
  };
}

/** 分类单 commit 的文件清单 */
export function classifyCommitFiles(
  commit: CommitInput,
  testGlobs: string[],
  noncodeGlobs: string[],
): CommitFileClassification {
  if (commit.files.length === 0) {
    return { exempt: true, hasTests: false };
  }
  let hasTests = false;
  let hasCode = false;
  for (const file of commit.files) {
    if (matchAnyGlob(file, testGlobs)) {
      hasTests = true;
    } else if (!matchAnyGlob(file, noncodeGlobs)) {
      hasCode = true;
    }
  }
  return { exempt: !hasCode, hasTests };
}
