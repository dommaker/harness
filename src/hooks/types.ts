/**
 * Hooks 类型定义
 *
 * 通用 hook 管线：注册、排序、错误隔离、采样。
 * 无业务逻辑，consumer 自行定义 hook 名称和语义。
 */

/**
 * Hook 执行时机
 */
export type HookPhase = 'before' | 'after' | 'around';

/**
 * Hook 错误处理策略
 */
export type HookErrorStrategy = 'block' | 'warn' | 'ignore';

/**
 * Hook 定义
 *
 * Consumer 自行选择 name（如 'beforeAgentExecute'），harness 只提供管线。
 */
export interface HookDefinition<C = unknown, R = unknown> {
  /** Hook 唯一名称（consumer 定义语义） */
  name: string;
  /** 执行时机 */
  phase: HookPhase;
  /** 优先级（越小越先执行，默认 100） */
  priority?: number;
  /** 错误策略：block=阻断管线, warn=记录警告继续, ignore=静默跳过 */
  errorStrategy?: HookErrorStrategy;
  /** 采样率 0-1（1=100% 执行，0.1=10% 采样） */
  sampleRate?: number;
  /** 是否启用 */
  enabled?: boolean;
  /** Hook 执行函数 */
  execute: (context: C) => Promise<HookResult<R>>;
}

/**
 * Hook 执行结果
 */
export interface HookResult<R = unknown> {
  /** 是否通过（blocking hook 必须返回 false 才阻断） */
  passed: boolean;
  /** 结果数据 */
  data?: R;
  /** 错误信息 */
  error?: string;
  /** 元数据（consumer 自行定义） */
  metadata?: Record<string, unknown>;
}

/**
 * Hook 执行记录
 */
export interface HookExecutionRecord {
  hookName: string;
  phase: HookPhase;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  passed: boolean;
  error?: string;
  sampled?: boolean;
}

/**
 * 管线执行结果
 */
export interface PipelineResult {
  /** 是否全部通过（blocking hook 任一失败 = false） */
  passed: boolean;
  /** 各 hook 执行记录 */
  records: HookExecutionRecord[];
  /** 失败的 blocking hook 名称列表 */
  blockedBy: string[];
  /** 警告 hook 名称列表 */
  warnings: string[];
}
