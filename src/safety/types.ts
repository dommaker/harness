/**
 * Safety Guardrails 类型定义
 */

// ── Sandbox ──────────────────────────────────────────────

/** Sandbox 安全级别 */
export type SandboxLevel = 1 | 2 | 3 | 4;

/** Sandbox 配置 */
export interface SandboxConfig {
  level: SandboxLevel;
  /** 允许写入的目录（Level 2+） */
  writableDirs?: string[];
  /** 允许的网络白名单（Level 3） */
  allowedHosts?: string[];
  /** 需要用户确认的操作（Level 4） */
  requiresConfirmation?: boolean;
}

/** Sandbox 权限检查结果 */
export interface SandboxCheckResult {
  allowed: boolean;
  reason?: string;
  currentLevel: SandboxLevel;
  requiredLevel: SandboxLevel;
}

// ── Input Guardrail ──────────────────────────────────────

/** 输入检查结果 */
export interface InputCheckResult {
  safe: boolean;
  violations: InputViolation[];
}

/** 输入违规 */
export interface InputViolation {
  type: 'injection' | 'intent' | 'permission';
  severity: 'low' | 'medium' | 'high';
  description: string;
  matchedPattern?: string;
}

/** 输入护栏配置 */
export interface InputGuardrailConfig {
  /** 注入检测模式 */
  injectionPatterns?: RegExp[];
  /** 禁止的意图关键词 */
  blockedIntents?: string[];
  /** 最大输入长度 */
  maxInputLength?: number;
}

// ── Output Guardrail ─────────────────────────────────────

/** 输出检查结果 */
export interface OutputSafetyCheckResult {
  safe: boolean;
  violations: OutputViolation[];
  sanitizedContent?: string;
}

/** 输出违规 */
export interface OutputViolation {
  type: 'sensitive_info' | 'quality' | 'knowledge_missing';
  severity: 'low' | 'medium' | 'high';
  description: string;
  location?: { line: number; column: number };
  matchedPattern?: string;
}

/** 输出护栏配置 */
export interface OutputGuardrailConfig {
  /** 敏感信息模式（API keys, passwords, etc.） */
  sensitivePatterns?: RegExp[];
  /** 代码质量最低分数 */
  minQualityScore?: number;
  /** 是否检查知识引用完整性 */
  checkKnowledgeRefs?: boolean;
}

// ── Tool Guardrail ───────────────────────────────────────

/** 工具检查结果 */
export interface ToolCheckResult {
  allowed: boolean;
  violations: ToolViolation[];
}

/** 工具违规 */
export interface ToolViolation {
  type: 'blacklist' | 'sandbox' | 'rate_limit';
  severity: 'low' | 'medium' | 'high';
  description: string;
  toolName?: string;
}

/** 工具护栏配置 */
export interface ToolGuardrailConfig {
  /** 命令黑名单 */
  blacklistedCommands?: string[];
  /** 每分钟最大调用次数 */
  rateLimit?: number;
  /** 各工具的 sandbox 级别要求 */
  toolSandboxLevels?: Record<string, SandboxLevel>;
}

/** 速率限制状态 */
export interface RateLimitState {
  count: number;
  windowStart: number;
}

// ── Aggregate ────────────────────────────────────────────

/** 安全检查汇总 */
export interface SafetyCheckResult {
  safe: boolean;
  inputCheck: InputCheckResult;
  outputCheck: OutputSafetyCheckResult;
  toolCheck: ToolCheckResult;
  timestamp: string;
}
