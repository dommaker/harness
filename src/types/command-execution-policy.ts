/**
 * 统一命令执行策略类型（D3，P0.5 Phase 1 副作用授权）
 *
 * check / validate / report 共用同一授权与跳过语义：
 * - 授权来源只有 CLI flag --read-only；仓内 YAML 只声明命令，不作为授权来源
 *   （不新增 exec: allowed 之类自证可信配置）
 * - readOnly = true：消费方不得执行任何项目 YAML 声明的命令，结果以三态 skipped
 *   上报（skipReason 统一由策略措辞），不产生「已检查」假绿
 * - execute 是注入执行缝：普通模式下消费方经它执行；read-only 下保证零调用。
 *   缺省（无策略）= 库调用保持默认执行（行为兼容）
 *
 * 类型住 types 层：CheckpointContext（types/checkpoint.ts）与 CheckEnv
 * （core/constraints/checkers/types.ts）都引用本策略，types 不能上行 import core。
 */

/**
 * 命令执行结果（执行缝统一形状）
 *
 * 与 exec 模板的 spawn 执行语义同形：退出码 / 信号 / 超时 / 启动错误 /
 * 截断的 stdout/stderr（各流有界保留，超出只记截断标记）。
 */
export interface ExecutedCommand {
  /** 退出码（被信号杀死/启动失败时为 null） */
  code: number | null;
  /** 终止信号（无 = null） */
  signal: NodeJS.Signals | null;
  /** 是否超时被杀 */
  timedOut: boolean;
  /** spawn 启动错误文本（如 shell 不可用） */
  spawnError?: string;
  /** stdout（有界截断） */
  stdout: string;
  /** stderr（有界截断） */
  stderr: string;
  /** 输出是否被截断 */
  truncated: boolean;
}

/**
 * 命令执行回调（执行缝）
 *
 * 参数：命令行（经 shell 执行）、工作目录、超时毫秒数。
 */
export type CommandExecutor = (
  command: string,
  cwd: string,
  timeoutMs: number
) => Promise<ExecutedCommand>;

/**
 * 统一命令执行策略（D3）
 *
 * 一次 check / validate / report 运行一份，由 CLI 组合根创建并沿调用链显式传递
 * （照 RunEnv / GitEvidence 同形：入口构造、沿链传递、不做模块级全局）。
 */
export interface CommandExecutionPolicy {
  /** read-only 模式：true = 不执行任何项目声明命令 */
  readonly readOnly: boolean;
  /**
   * read-only 跳过原因的唯一措辞来源（消费方只透传进 skipped.skipReason，
   * 不各自措辞）——含 --read-only 标记与命令原文
   */
  skipReason(command: string): string;
  /**
   * 真实执行回调：普通模式下消费方的唯一执行口；read-only 下保证零调用。
   * 缺省 = 真实 spawn 执行（超时杀进程组 + 流截断语义）。
   */
  execute: CommandExecutor;
}

/**
 * 项目 YAML 声明的命令清单项（执行清单的数据单元）
 *
 * source = 声明来源（约束 id / `<检查点id>/<检查id>`），command = 声明的命令原文。
 */
export interface CommandPlanItem {
  /** 声明来源 */
  source: string;
  /** 命令原文 */
  command: string;
}
