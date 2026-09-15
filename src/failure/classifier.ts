/**
 * 错误分类器
 *
 * 纯函数分类能力，不包含业务逻辑
 */

import type {
  ErrorType,
  FailureLevel,
  ErrorClassificationRule,
  ClassificationResult,
} from '../types/failure';
import {
  ErrorType as ErrorTypeEnum,
  FailureLevel as FailureLevelEnum,
  DEFAULT_CLASSIFICATION_RULES,
  DEFAULT_LEVEL_MAPPING,
} from '../types/failure';

/**
 * 错误分类器配置
 */
export interface ErrorClassifierConfig {
  /** 自定义分类规则 */
  rules?: ErrorClassificationRule[];
  /** 自定义等级映射 */
  levelMapping?: Partial<Record<ErrorType, FailureLevel>>;
}

/**
 * 错误分类器
 *
 * 用法：
 * ```typescript
 * const classifier = new ErrorClassifier();
 * const result = classifier.classify(new Error('test failed'));
 * // result.type === ErrorType.TEST_FAILED
 * ```
 */
export class ErrorClassifier {
  private rules: ErrorClassificationRule[];
  private levelMapping: Record<ErrorType, FailureLevel>;

  constructor(config?: ErrorClassifierConfig) {
    // 合并默认规则和自定义规则
    this.rules = config?.rules
      ? [...config.rules, ...DEFAULT_CLASSIFICATION_RULES]
      : DEFAULT_CLASSIFICATION_RULES;

    // 合并默认等级映射和自定义映射
    this.levelMapping = {
      ...DEFAULT_LEVEL_MAPPING,
      ...config?.levelMapping,
    };
  }

  /**
   * 分类错误
   */
  classify(error: Error): ClassificationResult {
    const message = error.message.toLowerCase();
    const name = error.name?.toLowerCase() || '';

    // 遍历规则，按优先级匹配
    for (const rule of this.rules) {
      if (this.matchRule(message, name, rule)) {
        return {
          type: rule.type,
          level: rule.level ?? this.levelMapping[rule.type],
          matchedRule: rule,
          originalError: error,
        };
      }
    }

    // 未知错误
    return {
      type: ErrorTypeEnum.UNKNOWN,
      level: this.levelMapping[ErrorTypeEnum.UNKNOWN],
      originalError: error,
    };
  }

  /**
   * 获取错误类型对应的失败等级
   */
  getLevel(type: ErrorType): FailureLevel {
    return this.levelMapping[type] ?? FailureLevelEnum.L2;
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: ErrorClassificationRule): void {
    // 自定义规则插入到前面，优先匹配
    this.rules.unshift(rule);
  }

  /**
   * 获取所有规则
   */
  getRules(): ErrorClassificationRule[] {
    return [...this.rules];
  }

  /**
   * 匹配规则
   */
  private matchRule(message: string, name: string, rule: ErrorClassificationRule): boolean {
    // 检查关键词
    if (rule.keywords && rule.keywords.length > 0) {
      const textToMatch = `${message} ${name}`;
      const hasKeyword = rule.keywords.some((kw) =>
        textToMatch.includes(kw.toLowerCase())
      );
      if (hasKeyword) {
        return true;
      }
    }

    // 检查正则模式
    if (rule.patterns && rule.patterns.length > 0) {
      const textToMatch = `${message} ${name}`;
      const hasPattern = rule.patterns.some((pattern) => pattern.test(textToMatch));
      if (hasPattern) {
        return true;
      }
    }

    return false;
  }
}

/**
 * 创建错误分类器
 */
export function createErrorClassifier(
  config?: ErrorClassifierConfig
): ErrorClassifier {
  return new ErrorClassifier(config);
}

/**
 * 快速分类错误（无需创建实例）
 */
export function classifyError(error: Error): ErrorType {
  const classifier = new ErrorClassifier();
  return classifier.classify(error).type;
}

/**
 * 快速获取失败等级
 */
export function getFailureLevel(type: ErrorType): FailureLevel {
  return DEFAULT_LEVEL_MAPPING[type] ?? FailureLevelEnum.L2;
}
