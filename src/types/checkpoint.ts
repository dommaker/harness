/**
 * 检查点类型定义
 */

/**
 * 检查类型
 */
export type CheckType =
  | 'file_exists'
  | 'file_not_empty'
  | 'file_contains'
  | 'file_not_contains'
  | 'command_success'
  | 'command_output'
  | 'output_contains'
  | 'output_not_contains'
  | 'output_matches'
  | 'json_path'
  | 'http_status'
  | 'http_body'
  | 'custom';

/**
 * 检查配置（判别联合成员的公共可选字段基座）
 */
export interface CheckConfigBase {
  /** 工作目录 */
  workdir?: string;

  /** 环境变量 */
  env?: Record<string, string>;

  /** 超时时间（毫秒） */
  timeout?: number;
}

/** 预期值（contains / output / json_path / http 各族的期望值形状） */
type CheckExpectation = string | number | boolean | object;

/**
 * 检查项定义（判别联合，重构班次 3 Phase 5）
 *
 * 以 `type` 为判别子，每个成员的 `config` 收窄为该 CheckType 的必填形状——
 * 取代原 13 可选字段服务 13 种 type 的宽 `CheckConfig`（下游 handler 全部
 * `config.x || ''` 假值兜底）。加载路径（checkpoints.yml 解析）按 type 校验
 * 必填字段，缺字段 fail-fast 指名（见 core/validators/checkpoint.ts 的
 * `assertCheckpointShape`）。
 */
interface CheckpointCheckBase {
  /** 检查 ID */
  id: string;

  /** 错误消息 */
  message?: string;

  /** 是否必须通过 */
  required?: boolean;
}

/** file_exists / file_not_empty：必填文件路径 */
export interface FileExistsCheck extends CheckpointCheckBase {
  type: 'file_exists' | 'file_not_empty';
  config: CheckConfigBase & { path: string };
}

/** file_contains / file_not_contains：必填路径 + 内容 */
export interface FileContentCheck extends CheckpointCheckBase {
  type: 'file_contains' | 'file_not_contains';
  config: CheckConfigBase & { path: string; content: string };
}

/** command_success：必填命令 */
export interface CommandSuccessCheck extends CheckpointCheckBase {
  type: 'command_success';
  config: CheckConfigBase & { command: string };
}

/** command_output：必填命令 + 预期输出 */
export interface CommandOutputCheck extends CheckpointCheckBase {
  type: 'command_output';
  config: CheckConfigBase & { command: string; expected: CheckExpectation };
}

/** output_contains / output_not_contains：content 优先、expected 兜底（空内容 = 「输出应为空」语义） */
export interface OutputContentCheck extends CheckpointCheckBase {
  type: 'output_contains' | 'output_not_contains';
  config: CheckConfigBase & { content?: string; expected?: CheckExpectation; command?: string };
}

/** output_matches：必填正则 */
export interface OutputMatchesCheck extends CheckpointCheckBase {
  type: 'output_matches';
  config: CheckConfigBase & { pattern: string; command?: string };
}

/** json_path：必填 JSON 路径 */
export interface JsonPathCheck extends CheckpointCheckBase {
  type: 'json_path';
  config: CheckConfigBase & { jsonPath: string; expected?: CheckExpectation; command?: string };
}

/** http_status：必填 URL（expectedStatus 缺省 200） */
export interface HttpStatusCheck extends CheckpointCheckBase {
  type: 'http_status';
  config: CheckConfigBase & { url: string; expectedStatus?: number; expected?: CheckExpectation };
}

/** http_body：必填 URL + 预期响应体片段 */
export interface HttpBodyCheck extends CheckpointCheckBase {
  type: 'http_body';
  config: CheckConfigBase & {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    /** HTTP 请求体（JSON 序列化后发送，形状由被测端点决定） */
    body?: unknown;
    expected: CheckExpectation;
  };
}

/** custom：必填自定义检查函数名 */
export interface CustomCheck extends CheckpointCheckBase {
  type: 'custom';
  config: CheckConfigBase & { customFunction: string };
}

/**
 * 检查项（13 种 CheckType 的判别联合）
 */
export type CheckpointCheck =
  | FileExistsCheck
  | FileContentCheck
  | CommandSuccessCheck
  | CommandOutputCheck
  | OutputContentCheck
  | OutputMatchesCheck
  | JsonPathCheck
  | HttpStatusCheck
  | HttpBodyCheck
  | CustomCheck;

/**
 * 检查配置（联合别名：全体成员的 config 之并，兼容类型位引用）
 */
export type CheckConfig = CheckpointCheck['config'];

/**
 * 检查点定义
 */
export interface Checkpoint {
  /** 检查点 ID */
  id: string;
  
  /** 检查点名称 */
  name?: string;
  
  /** 描述 */
  description?: string;
  
  /** 检查列表 */
  checks: CheckpointCheck[];
  
  /** 是否必须全部通过 */
  requireAll?: boolean;
}

/**
 * 单项检查结果
 */
export interface CheckResult {
  /** 检查 ID */
  checkId: string;
  
  /** 是否通过 */
  passed: boolean;
  
  /** 消息 */
  message?: string;
  
  /** 错误详情 */
  error?: string;
  
  /** 实际值（形状随检查类型而异，消费端自行窄化） */
  actual?: unknown;
  
  /** 预期值（同 actual，开放形状） */
  expected?: unknown;
}

/**
 * 检查点验证结果
 */
export interface CheckpointResult {
  /** 检查点 ID */
  checkpointId: string;
  
  /** 是否全部通过 */
  passed: boolean;
  
  /** 各项检查结果 */
  checks: CheckResult[];
  
  /** 消息 */
  message?: string;
  
  /** 验证时间 */
  validatedAt: Date;
}

/**
 * 检查点验证上下文
 */
export interface CheckpointContext {
  /** 项目路径 */
  projectPath: string;
  
  /** 工作目录 */
  workdir: string;
  
  /** 环境变量 */
  env?: Record<string, string>;
  
  /** 步骤输出（用于 output_* 检查；string 直用，其余 JSON 序列化） */
  output?: unknown;
  
  /** 自定义检查处理器 */
  customHandlers?: Map<string, (config: CheckConfig) => Promise<CheckResult>>;
  
  /**
   * 重试退避的等待注入（http_* 检查族消费）
   * 缺省 = 真定时器；测试可注入零等待替身，据此断言重试语义而不必真等
   */
  sleep?: (ms: number) => Promise<void>;
}