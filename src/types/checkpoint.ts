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
 * 检查配置
 */
export interface CheckConfig {
  /** 文件路径（用于文件检查） */
  path?: string;
  
  /** 预期值（用于 contains 检查） */
  expected?: string | number | boolean | object;
  
  /** 内容（用于 file_contains 检查） */
  content?: string;
  
  /** 正则表达式（用于 matches 检查） */
  pattern?: string;
  
  /** JSON 路径（用于 json_path 检查） */
  jsonPath?: string;
  
  /** HTTP URL（用于 http 检查） */
  url?: string;
  
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  
  /** HTTP 请求体 */
  body?: any;
  
  /** HTTP 请求头 */
  headers?: Record<string, string>;
  
  /** 预期 HTTP 状态码 */
  expectedStatus?: number;
  
  /** 命令（用于 command 检查） */
  command?: string;
  
  /** 工作目录 */
  workdir?: string;
  
  /** 环境变量 */
  env?: Record<string, string>;
  
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 自定义检查函数名 */
  customFunction?: string;
}

/**
 * 检查项定义
 */
export interface CheckpointCheck {
  /** 检查 ID */
  id: string;
  
  /** 检查类型 */
  type: CheckType;
  
  /** 检查配置 */
  config: CheckConfig;
  
  /** 错误消息 */
  message?: string;
  
  /** 是否必须通过 */
  required?: boolean;
}

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
  
  /** 实际值 */
  actual?: any;
  
  /** 预期值 */
  expected?: any;
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
  
  /** 步骤输出（用于 output_* 检查） */
  output?: any;
  
  /** 自定义检查处理器 */
  customHandlers?: Map<string, (config: CheckConfig) => Promise<CheckResult>>;
  
  /**
   * 重试退避的等待注入（http_* 检查族消费）
   * 缺省 = 真定时器；测试可注入零等待替身，据此断言重试语义而不必真等
   */
  sleep?: (ms: number) => Promise<void>;
}