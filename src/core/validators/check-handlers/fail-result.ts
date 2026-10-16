/**
 * 失败 CheckResult 唯一构造（四族 handler 共享，重构班次 3 Phase 3）
 *
 * catch / 读取失败分支的 ~10 行块原重复 6+ 处：message 归调用方（各族措辞不同），
 * detail 同时落 actual 与 error，expected 保持各族原语义（'exit code 0' / 配置期望等）。
 */

import type { CheckResult } from '../../../types/checkpoint';

/**
 * 构造失败结果：actual = error = detail（文本即诊断），passed = false
 */
export function failResult(checkId: string, message: string, detail: string, expected: unknown): CheckResult {
  return { checkId, passed: false, message, actual: detail, expected, error: detail };
}
