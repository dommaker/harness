/**
 * 治理模块
 *
 * harness 检测差异，LLM 自行修复
 * 只提供检测能力，不提供修复机制
 */

export { GovernanceExecutor, governanceExecutor } from './executor';
export type {
  DiffType,
  GovernanceDiff,
  GovernanceResult,
} from './types';
