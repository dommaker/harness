/**
 * Completion Checkers（T7-E1，studio#160）
 *
 * WU 收尾软观测三件套——纯判定函数库：
 * - verifyTddChain：实现 commit 的 Tested-By 引用链验证
 * - verifyPhaseFormat：phase(...) subject 结构验证
 * - verifyContractPresence：通用契约在场引擎
 *
 * 与 ConstraintCheck 闭环注册表无关：直接 export，不注册、不碰 checkers/index.ts。
 * 函数不碰文件系统与 git；commits 由调用方（studio 第四段守卫，T7-E2）供给。
 */

export * from './types';
export { DEFAULT_TEST_GLOBS, DEFAULT_NONCODE_GLOBS, matchGlob, matchAnyGlob } from './glob-match';
export { classifyCommitFiles, resolveGlobs } from './classify';
export type { CommitFileClassification } from './classify';
export { verifyTddChain, TESTED_BY_RE, TESTS_NONE_RE } from './tdd-chain';
export { verifyPhaseFormat, PHASE_SUBJECT_RE } from './phase-format';
export { verifyContractPresence } from './contract-presence';
