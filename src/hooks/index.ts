/**
 * Hooks 模块
 *
 * 通用 hook 管线：注册 → 排序 → 错误隔离 → 采样执行。
 * 无业务逻辑，consumer 自行定义 hook 名称和语义。
 */

export * from './types';
export { HookRegistry } from './registry';
export { HookPipeline } from './pipeline';
export {
  bootstrapHarness,
  bootstrapHarnessSync,
  type HarnessBootstrap,
} from './bootstrap';
