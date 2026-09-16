/**
 * Hook 配置归一（G7）
 *
 * studio 侧 per-hook 运行时配置（`blocking: boolean`）与 harness 侧
 * `HookConfig.errorStrategy` 双轨归一：以 errorStrategy 为唯一真相，
 * `blocking` → errorStrategy 为无损映射。
 *
 * 映射语义（确认于 H5）：
 * - blocking=true  → 'block'：hook 失败阻断管线（停止执行后续 hook，
 *   管线结果 passed=false、blockedBy 记名）——对应 studio safeCallHook 抛错
 * - blocking=false → 'warn'：hook 失败记录警告并继续执行后续 hook
 *   （管线结果 warnings 记名，passed 不受影响）——对应 studio safeCallHook
 *   console.warn 继续
 *
 * #159 起 `HookConfig` 是 `enabled` / `errorStrategy` 的唯一声明点：
 * HookDefinition 不再携带这两个字段，注册环节以配置表填充有效值，
 * 有效策略集合收敛为 'block' | 'warn'（原 'ignore' 退出有效面）。
 *
 * studio 侧随动（studio #150 A4）：hooks/config.ts 删 DEFAULTS/safeCallHook，
 * blocking→errorStrategy 无损映射进 toHookDef；HARNESS_HOOK_DISABLE 保留 studio。
 */

import type { HookErrorStrategy } from './types';

/**
 * blocking 布尔 → errorStrategy 无损映射（block/warn）
 *
 * @param blocking studio 侧「失败是否阻断」语义
 * @returns 'block'（阻断）| 'warn'（警告继续）
 */
export function toErrorStrategy(blocking: boolean): HookErrorStrategy {
  return blocking ? 'block' : 'warn';
}
