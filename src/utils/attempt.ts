/**
 * attempt — 显式降级执行（吞错治理，Phase 2）
 *
 * 只服务有意识的 fail-open 场景：provider 执法 hook（崩溃不能误伤用户操作）、
 * 事件回调隔离、非阻断副作用记账等。调用点必须另起一行注释写清降级理由——
 * 「这里有意降级」要在代码里看得见，而不是藏在空 catch 里
 * （反例教训：静默吞错会让解析/判定 bug 变成「永远通过」，harness#119）。
 *
 * 不属于本工具的用途：
 * - 存在性探测（文件在不在）→ 用 existsSync，不要 try/catch 也不要 attempt；
 * - 缺文件有领域语义（缺失 = 空集/未配置）→ 读面自己判 existsSync；
 * - 其余异常一律让它抛出（fail-fast）。
 */

/**
 * 同步版：fn 抛错时返回 onError(err) 的降级值。
 */
export function attempt<T>(fn: () => T, onError: (err: unknown) => T): T {
  try {
    return fn();
  } catch (err) {
    return onError(err);
  }
}

/**
 * 异步版：同上，吞的是 Promise rejection。
 */
export async function attemptAsync<T>(fn: () => Promise<T>, onError: (err: unknown) => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return onError(err);
  }
}
