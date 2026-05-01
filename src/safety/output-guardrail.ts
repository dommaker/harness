/**
 * 输出护栏
 *
 * 在最终输出前检查：
 * - 敏感信息审查（API keys, passwords, tokens）
 * - 代码质量检查
 * - 知识引用完整性
 */

import type { OutputSafetyCheckResult, OutputViolation, OutputGuardrailConfig } from './types';

const DEFAULT_SENSITIVE_PATTERNS: RegExp[] = [
  // API keys
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/gi,
  // AWS
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  // Generic secrets
  /(?:secret|password|passwd|token|auth)\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi,
  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9_]{36,}/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,
  // Connection strings
  /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi,
];

const DEFAULT_MIN_QUALITY_SCORE = 0.6;

export class OutputGuardrail {
  private sensitivePatterns: RegExp[];
  private minQualityScore: number;
  private checkKnowledgeRefs: boolean;

  constructor(config?: OutputGuardrailConfig) {
    this.sensitivePatterns = config?.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS;
    this.minQualityScore = config?.minQualityScore ?? DEFAULT_MIN_QUALITY_SCORE;
    this.checkKnowledgeRefs = config?.checkKnowledgeRefs ?? false;
  }

  /**
   * 检查输出安全性
   */
  check(content: string, knowledgeRefIds?: string[]): OutputSafetyCheckResult {
    const violations: OutputViolation[] = [];

    // 敏感信息检测
    violations.push(...this.checkSensitiveInfo(content));

    // 代码质量检查
    violations.push(...this.checkQuality(content));

    // 知识引用完整性
    if (this.checkKnowledgeRefs && knowledgeRefIds) {
      violations.push(...this.checkKnowledgeRefs_(
        content,
        knowledgeRefIds,
      ));
    }

    const sanitized = violations.length > 0
      ? this.sanitize(content, violations)
      : undefined;

    return {
      safe: violations.length === 0,
      violations,
      sanitizedContent: sanitized,
    };
  }

  /**
   * 检测敏感信息
   */
  private checkSensitiveInfo(content: string): OutputViolation[] {
    const violations: OutputViolation[] = [];

    for (const pattern of this.sensitivePatterns) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const line = this.getLineNumber(content, match.index);
        violations.push({
          type: 'sensitive_info',
          severity: 'high',
          description: `检测到敏感信息: ${match[0].slice(0, 30)}...`,
          location: { line, column: match.index - content.lastIndexOf('\n', match.index) - 1 },
          matchedPattern: match[0],
        });
      }
    }

    return violations;
  }

  /**
   * 代码质量检查（简单启发式）
   */
  private checkQuality(content: string): OutputViolation[] {
    const violations: OutputViolation[] = [];

    // 检查 TODO/FIXME/HACK
    const todoPattern = /\b(TODO|FIXME|HACK|XXX)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = todoPattern.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      violations.push({
        type: 'quality',
        severity: 'low',
        description: `代码包含 ${match[1]} 标记`,
        location: { line, column: match.index - content.lastIndexOf('\n', match.index) - 1 },
      });
    }

    // 检查 console.log 残留
    const consolePattern = /console\.(log|debug|info)\(/g;
    while ((match = consolePattern.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      violations.push({
        type: 'quality',
        severity: 'low',
        description: `代码包含 ${match[0].slice(0, -1)} 调用`,
        location: { line, column: match.index - content.lastIndexOf('\n', match.index) - 1 },
      });
    }

    return violations;
  }

  /**
   * 检查知识引用完整性
   */
  private checkKnowledgeRefs_(content: string, referencedIds: string[]): OutputViolation[] {
    const violations: OutputViolation[] = [];

    for (const id of referencedIds) {
      if (!content.includes(id)) {
        violations.push({
          type: 'knowledge_missing',
          severity: 'medium',
          description: `引用的知识条目 ${id} 未出现在输出中`,
        });
      }
    }

    return violations;
  }

  /**
   * 清理敏感信息
   */
  private sanitize(content: string, violations: OutputViolation[]): string {
    let sanitized = content;

    for (const violation of violations) {
      if (violation.type === 'sensitive_info' && violation.matchedPattern) {
        // Escape special regex characters in the matched string
        const escaped = violation.matchedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(new RegExp(escaped, 'g'), '[REDACTED]');
      }
    }

    return sanitized;
  }

  /**
   * 获取行号
   */
  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split('\n').length;
  }
}
