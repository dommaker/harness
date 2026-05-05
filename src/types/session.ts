/**
 * Session 相关类型定义
 */

/**
 * Session Startup 检查点配置
 */
export interface StartupCheckpoints {
  required: StartupCheckpointType[];
  optional?: StartupCheckpointType[];
  timeout?: number;          // 检查点超时（毫秒）
  contextFiles?: string[];   // 启动时加载的上下文文件
}

export type StartupCheckpointType = 
  | 'pwd'
  | 'git_log'
  | 'git_status'
  | 'read_progress'
  | 'read_task_list'
  | 'init_sh'
  | 'basic_verification'
  | 'load_context';

/**
 * Startup 检查点结果
 */
export interface StartupCheckpointResult {
  type: StartupCheckpointType;
  success: boolean;
  data?: any;
  error?: string;
  duration: number;  // 执行时长（毫秒）
}

/**
 * Clean State 配置
 */
export interface CleanStateConfig {
  enabled: boolean;
  autoCommit?: boolean;       // 是否自动提交未提交的变更
  detectBugs?: boolean;       // 是否检测 bug
  updateProgress?: boolean;   // 是否更新 progress 文件
  commitMessageTemplate?: string;  // 提交消息模板
}

/**
 * Clean State 结果
 */
export interface CleanStateResult {
  isClean: boolean;
  hasUncommittedChanges: boolean;
  committedFiles?: string[];
  bugs?: DetectedBug[];
  progressUpdated: boolean;
  errors?: string[];
}

/**
 * 检测到的 Bug
 */
export interface DetectedBug {
  file: string;
  line?: number;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'syntax' | 'runtime' | 'logic' | 'security' | 'performance';
}

/**
 * Task List JSON 格式（扩展自 tasks.yml）
 */
export interface TaskListJson {
  tasks: DynamicTask[];
  metadata?: {
    created_at?: string;
    updated_at?: string;
    workflow_id?: string;
    project_name?: string;
  };
}

/**
 * 动态任务定义
 */
export interface DynamicTask {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  type?: string;
  priority?: number;
  steps?: string[];
  
  // 约束机制字段
  passes?: boolean;              // 任务是否通过（只能由测试结果修改）
  test_result?: TaskTestResult;  // 测试证据
  step_status?: Record<string, TaskStepStatus>;  // 步骤状态跟踪
  current_step?: string;         // 当前执行的步骤
  current_step_index?: number;   // 当前步骤索引
}

/**
 * 测试结果
 */
export interface TaskTestResult {
  passed: boolean;
  command: string;
  output?: string;
  failures?: string[];
  coverage?: number;
  timestamp: Date;
  evidence?: string;
}

/**
 * 步骤状态
 */
export interface TaskStepStatus {
  completed: boolean;
  result?: string;
  timestamp?: string;
}

/**
 * Session 信息
 */
export interface SessionInfo {
  sessionId: string;
  workflowId: string;
  task?: DynamicTask;
}