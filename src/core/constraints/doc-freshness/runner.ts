/**
 * FreshnessRunner — 配置驱动的文档新鲜度检查引擎
 *
 * 所有检查是纯同步文件系统操作，零 LLM 调用。
 * 通过 DocFreshnessConfig 配置驱动，不绑定任何项目结构。
 *
 * 四种检查一型一文（重构班次 3 Phase 4 拆出，本文件只留调度与公共类型）：
 * - changelog_version → ./check-changelog-version
 * - context_docs → ./check-context-docs
 * - doc_dir_check → ./check-doc-dir
 * - doc_regex_count → ./check-doc-regex-count（计数助手 countFromDir/countFromGrep 同文件）
 */

import type {
  DocFreshnessCheck,
  DocFreshnessConfig,
} from '../../../types/project-config';
import { checkChangelogVersion } from './check-changelog-version';
import { checkContextDocs } from './check-context-docs';
import { checkDocDir } from './check-doc-dir';
import { checkDocRegexCount } from './check-doc-regex-count';

// 计数助手原为本类公开方法（仓内零外部调用方），模块路径级保留可引
export { countFromDir, countFromGrep } from './check-doc-regex-count';

/**
 * Freshness 检查结果
 */
export interface FreshnessCheckResult {
  /** 检查类型 */
  type: string;
  /** 人类可读标签 */
  label: string;
  /** 是否通过 */
  pass: boolean;
  /** 失败时的消息 */
  message?: string;
  /** 额外详情 */
  detail?: Record<string, unknown>;
}

/**
 * FreshnessRunner 执行上下文
 */
export interface RunContext {
  projectPath: string;
  /** 外部提供的 required_dirs（来自 governance.context_files，用于 context_docs 检查的默认 dirs） */
  requiredDirs?: string[];
  /**
   * 源码根的**懒取**提供者（ADR-0023 决策 4）：只在 doc_dir_check 从文档目录
   * 推断不出根时用到。调用方传 `() => env.sourceRoots()` 即与本 run 其余消费方
   * 共用一次探测；不传（sync-docs 等一次性调用方）则本模块自探一次。
   */
  sourceRoots?: () => string[];
}

/**
 * 配置驱动的文档新鲜度检查引擎
 */
export class FreshnessRunner {
  /**
   * 运行所有配置的文档新鲜度检查
   */
  runAll(
    config: DocFreshnessConfig,
    projectPath: string,
    ctx?: {
      requiredDirs?: string[];
      sourceRoots?: () => string[];
    }
  ): FreshnessCheckResult[] {
    if (config.enabled === false) return [];
    if (!config.checks || config.checks.length === 0) return [];

    const context: RunContext = {
      projectPath,
      requiredDirs: ctx?.requiredDirs,
      sourceRoots: ctx?.sourceRoots,
    };

    return config.checks.map(check => this.runSingle(check, context));
  }

  /**
   * 执行单个检查
   */
  runSingle(check: DocFreshnessCheck, context: RunContext): FreshnessCheckResult {
    switch (check.type) {
      case 'changelog_version':
        return checkChangelogVersion(check, context);
      case 'context_docs':
        return checkContextDocs(check, context);
      case 'doc_dir_check':
        return checkDocDir(check, context);
      case 'doc_regex_count':
        return checkDocRegexCount(check, context);
      default: {
        // 运行时可达（check 来自 yml 反序列化，未登记类型漏过校验）：窄化取 type 上报
        const raw = check as { type?: string };
        return {
          type: raw.type || 'unknown',
          label: 'Unknown',
          pass: true,
          message: `未知的检查类型: ${raw.type}`,
        };
      }
    }
  }
}
