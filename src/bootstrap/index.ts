/**
 * Hooks 模块
 *
 * ADR-0027（#170）起本层只剩 `bootstrap.ts` 一个面：通用 hook 管线
 * （registry / pipeline / config / types 四文件）双仓零生产消费者，整体删除。
 * 目录名沿用历史，职责是 harness 运行环境的组合根。
 */

export { bootstrapHarness, bootstrapHarnessSync } from './bootstrap';
export type { HarnessBootstrap } from './bootstrap';
