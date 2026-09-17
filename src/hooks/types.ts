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
 * Hook 错误处理策略（有效集合：'block' | 'warn'）
 *
 * #159 起原 'ignore' 退出有效面：策略的唯一声明点是 HookConfig（必填），
 * 不存在「未声明 strategy」的运行时形态。
 */
export type HookErrorStrategy = 'block' | 'warn';

/**
 * Hook 配置（G7 归一后形状：consumer 侧的 per-hook 声明表）
 *
 * 声明与实现构成注册表闭环（assertHookRegistryClosed 双向校验）：
 * - 声明（HookConfig）是「定义」侧：引用未注册实现 → 抛错
 * - 注册（HookDefinition）是「实现」侧：注册无对应声明 → 抛错
 *
 * #159 起本表是 `enabled` / `errorStrategy` 的**唯一声明点**：
 * HookDefinition 不再携带这两个字段，有效值在注册环节由本表填充
 * （见 EffectiveHook），声明与实现两处值矛盾在构造上不可能出现。
 *
 * 对应 studio 侧 per-hook 运行时配置（hooks/config.ts 的 DEFAULTS）语义：
 * blocking:true ↔ errorStrategy 'block'（失败阻断管线），
 * blocking:false ↔ errorStrategy 'warn'（记录警告继续）——无损映射见
 * config.ts 的 toErrorStrategy。
 */
export interface HookConfig {
  /** Hook 唯一名称（须与注册的 HookDefinition.name 一致） */
  name: string;
  /** 是否启用（false 时不进入管线） */
  enabled: boolean;
  /** 错误策略：block=失败阻断管线，warn=记录警告继续 */
  errorStrategy: HookErrorStrategy;
}

/**
 * Hook 定义
 *
 * Consumer 自行选择 name（如 'beforeAgentExecute'），harness 只提供管线。
 * `enabled` / `errorStrategy` 不在此处声明——唯一声明点是 HookConfig（#159）。
 */
export interface HookDefinition<C = unknown, R = unknown> {
  /** Hook 唯一名称（consumer 定义语义） */
  name: string;
  /** 执行时机 */
  phase: HookPhase;
  /** 优先级（越小越先执行，默认 100） */
  priority?: number;
  /** 采样率 0-1（1=100% 执行，0.1=10% 采样） */
  sampleRate?: number;
  /** Hook 执行函数 */
  execute: (context: C) => Promise<HookResult<R>>;
}

/**
 * 有效 hook = HookDefinition + 注册环节由 HookConfig 填充的有效值
 *
 * 管线与注册表的判定（启用过滤、block/warn 分派）只读本类型，
 * 值来源单一（HookConfig），不存在第二声明点。
 */
export interface EffectiveHook<C = unknown, R = unknown> extends HookDefinition<C, R> {
  /** 是否启用（来自 HookConfig.enabled） */
  enabled: boolean;
  /** 错误策略（来自 HookConfig.errorStrategy） */
  errorStrategy: HookErrorStrategy;
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
  /** 未执行标记之二：enabled:false 被 runOne 跳过（实现体零调用，镜像 sampled 先例） */
  skipped?: boolean;
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
