/**
 * 工具护栏
 *
 * 每次工具调用前检查：
 * - 命令黑名单
 * - Sandbox 级别检查
 * - 速率限制
 */

import type {
  ToolCheckResult,
  ToolViolation,
  ToolGuardrailConfig,
  RateLimitState,
  SandboxLevel,
} from './types';
import { Sandbox } from './sandbox';

const DEFAULT_BLACKLISTED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',  // fork bomb
  'chmod -R 777 /',
  '| sh',
  '| bash',
  'eval(',
  'exec(',
];

const DEFAULT_RATE_LIMIT = 60; // per minute

export class ToolGuardrail {
  private blacklistedCommands: string[];
  private rateLimit: number;
  private toolSandboxLevels: Record<string, SandboxLevel>;
  private rateLimitState: Map<string, RateLimitState>;
  private sandbox: Sandbox;

  constructor(sandbox: Sandbox, config?: ToolGuardrailConfig) {
    this.sandbox = sandbox;
    this.blacklistedCommands = config?.blacklistedCommands ?? DEFAULT_BLACKLISTED_COMMANDS;
    this.rateLimit = config?.rateLimit ?? DEFAULT_RATE_LIMIT;
    this.toolSandboxLevels = config?.toolSandboxLevels ?? {};
    this.rateLimitState = new Map();
  }

  /**
   * 检查工具调用是否允许
   */
  check(toolName: string, command?: string): ToolCheckResult {
    const violations: ToolViolation[] = [];

    // 命令黑名单检查
    if (command) {
      violations.push(...this.checkBlacklist(toolName, command));
    }

    // Sandbox 级别检查
    violations.push(...this.checkSandboxLevel(toolName));

    // 速率限制检查
    violations.push(...this.checkRateLimit(toolName));

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  /**
   * 检查命令黑名单
   */
  private checkBlacklist(toolName: string, command: string): ToolViolation[] {
    const violations: ToolViolation[] = [];
    const lower = command.toLowerCase();

    for (const blocked of this.blacklistedCommands) {
      if (lower.includes(blocked.toLowerCase())) {
        violations.push({
          type: 'blacklist',
          severity: 'high',
          description: `命令包含被阻止的模式: ${blocked}`,
          toolName,
        });
      }
    }

    return violations;
  }

  /**
   * 检查 sandbox 级别
   */
  private checkSandboxLevel(toolName: string): ToolViolation[] {
    const violations: ToolViolation[] = [];
    const requiredLevel = this.toolSandboxLevels[toolName];

    if (requiredLevel !== undefined) {
      const result = this.sandbox.check(requiredLevel);
      if (!result.allowed) {
        violations.push({
          type: 'sandbox',
          severity: 'high',
          description: result.reason ?? `工具 ${toolName} 需要 Level ${requiredLevel}`,
          toolName,
        });
      }
    }

    return violations;
  }

  /**
   * 检查速率限制
   */
  private checkRateLimit(toolName: string): ToolViolation[] {
    const violations: ToolViolation[] = [];
    const now = Date.now();
    const state = this.rateLimitState.get(toolName);

    if (!state) {
      this.rateLimitState.set(toolName, { count: 1, windowStart: now });
      return violations;
    }

    // 重置窗口（1 分钟）
    if (now - state.windowStart > 60000) {
      state.count = 1;
      state.windowStart = now;
      return violations;
    }

    state.count++;

    if (state.count > this.rateLimit) {
      violations.push({
        type: 'rate_limit',
        severity: 'medium',
        description: `工具 ${toolName} 超过速率限制 (${this.rateLimit}/min)`,
        toolName,
      });
    }

    return violations;
  }

  /**
   * 添加黑名单命令
   */
  addBlacklistedCommand(command: string): void {
    this.blacklistedCommands.push(command);
  }

  /**
   * 设置工具 sandbox 级别要求
   */
  setToolSandboxLevel(toolName: string, level: SandboxLevel): void {
    this.toolSandboxLevels[toolName] = level;
  }

  /**
   * 重置速率限制状态
   */
  resetRateLimits(): void {
    this.rateLimitState.clear();
  }

  /**
   * 获取 sandbox 实例
   */
  getSandbox(): Sandbox {
    return this.sandbox;
  }
}
