/**
 * 输入护栏
 *
 * 在首个 Agent 执行前检查输入：
 * - 注入防御（prompt injection）
 * - 意图校验
 * - 权限验证
 */

import type { InputCheckResult, InputViolation, InputGuardrailConfig } from './types';

const DEFAULT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(all\s+)?(previous|above)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /<\|im_start\|>/i,
  /\[INST\]/i,
  /<<SYS>>/i,
  /human\s*:\s*/i,
  /assistant\s*:\s*/i,
  /override\s+(all\s+)?safety/i,
  /disregard\s+(all\s+)?rules/i,
  /act\s+as\s+if\s+you\s+(are|were)/i,
  /pretend\s+you\s+(are|were|have\s+no)/i,
  /do\s+anything\s+now/i,
  /DAN\s+mode/i,
];

const DEFAULT_BLOCKED_INTENTS: string[] = [
  'delete all files',
  'rm -rf /',
  'format disk',
  'drop table',
  'shutdown',
  'exfiltrate',
];

const DEFAULT_MAX_INPUT_LENGTH = 50000;

export class InputGuardrail {
  private patterns: RegExp[];
  private blockedIntents: string[];
  private maxInputLength: number;

  constructor(config?: InputGuardrailConfig) {
    this.patterns = config?.injectionPatterns ?? DEFAULT_INJECTION_PATTERNS;
    this.blockedIntents = config?.blockedIntents ?? DEFAULT_BLOCKED_INTENTS;
    this.maxInputLength = config?.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  }

  /**
   * 检查输入安全性
   */
  check(input: string): InputCheckResult {
    const violations: InputViolation[] = [];

    // 长度检查
    if (input.length > this.maxInputLength) {
      violations.push({
        type: 'injection',
        severity: 'medium',
        description: `输入长度 ${input.length} 超过限制 ${this.maxInputLength}`,
      });
    }

    // 注入检测
    violations.push(...this.checkInjection(input));

    // 意图校验
    violations.push(...this.checkIntent(input));

    return {
      safe: violations.length === 0,
      violations,
    };
  }

  /**
   * 检查 prompt injection 模式
   */
  private checkInjection(input: string): InputViolation[] {
    const violations: InputViolation[] = [];

    for (const pattern of this.patterns) {
      const match = input.match(pattern);
      if (match) {
        violations.push({
          type: 'injection',
          severity: 'high',
          description: `检测到潜在注入模式: ${match[0]}`,
          matchedPattern: pattern.source,
        });
      }
    }

    return violations;
  }

  /**
   * 检查恶意意图
   */
  private checkIntent(input: string): InputViolation[] {
    const violations: InputViolation[] = [];
    const lower = input.toLowerCase();

    for (const intent of this.blockedIntents) {
      if (lower.includes(intent.toLowerCase())) {
        violations.push({
          type: 'intent',
          severity: 'high',
          description: `检测到被阻止的意图: ${intent}`,
        });
      }
    }

    return violations;
  }

  /**
   * 添加注入检测模式
   */
  addPattern(pattern: RegExp): void {
    this.patterns.push(pattern);
  }

  /**
   * 添加阻止意图
   */
  addBlockedIntent(intent: string): void {
    this.blockedIntents.push(intent);
  }
}
