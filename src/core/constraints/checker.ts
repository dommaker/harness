/**
 * 约束检查引擎
 * 
 * 三层约束体系检查：
 * - Iron Laws：检查失败立即抛出异常
 * - Guidelines：检查失败记录警告
 * - Tips：检查失败记录提示
 */

import {
  Constraint,
  ConstraintContext,
  ConstraintResult,
  ConstraintCheckResult,
  ConstraintTrigger,
  ConstraintLevel,
  ConstraintViolationError,
} from '../../types/constraint';
import type { ExecutionTrace } from '../../types/trace';
import { getTraceCollector } from '../../monitoring/traces';
import { IRON_LAWS, GUIDELINES, TIPS, findConstraintsByTrigger } from './definitions';
import type { MergedConstraintsConfig } from '../../types/project-config';
import { normalizeTriggers } from '../../utils/exec';
import { runCommand } from '../../utils/exec';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import * as yaml from 'js-yaml';
import { CheckCache } from './check-cache';

/**
 * 例外名称 → ConstraintContext 中布尔字段的映射
 */
const EXCEPTION_FIELD_MAP: Record<string, keyof ConstraintContext> = {
  scalability_required: 'scalabilityRequired',
  security_required: 'securityRequired',
  performance_required: 'performanceRequired',
  reliability_required: 'reliabilityRequired',
  simple_typo: 'isSimpleTypo',
  config_value_error: 'isConfigValueError',
  missing_config: 'isMissingConfig',
  config_file: 'isConfigFile',
  type_definition: 'isTypeDefinition',
  simple_accessor: 'isSimpleAccessor',
  pure_display_component: 'isPureDisplayComponent',
  json_parse_result: 'isJsonParseResult',
  third_party_no_types: 'isThirdPartyNoTypes',
  legacy_migration: 'isLegacyMigration',
  internal_refactor: 'isInternalRefactor',
  bug_fix_only: 'isBugFixOnly',
  performance_optimization: 'isPerformanceOptimization',
  redundant_code_cleanup: 'isRedundantCodeCleanup',
  same_effect_refactor: 'isSameEffectRefactor',
  unused_code_removal: 'isUnusedCodeRemoval',
  external_dependency: 'isExternalDependency',
  explicit_instruction: 'isExplicitInstruction',
  emergency_fix: 'isEmergencyFix',
  existing_design: 'isExistingDesign',
};

/**
 * 约束检查器
 */
export class ConstraintChecker {
  private static instance: ConstraintChecker;

  /** 自定义约束配置（项目级） */
  private customConfig: MergedConstraintsConfig | null = null;

  /** 检查结果缓存（S7：减少重复 git diff / src scan I/O，TTL=1s 防跨测试污染） */
  private cache: CheckCache = new CheckCache({ ttlMs: 1000 });

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ConstraintChecker {
    if (!ConstraintChecker.instance) {
      ConstraintChecker.instance = new ConstraintChecker();
    }
    return ConstraintChecker.instance;
  }

  /**
   * 设置项目级约束配置
   *
   * @deprecated 修改单例状态，多项目并发时存在污染风险。
   * 请改用 checkConstraints() / beforeExecution() 的 customConfig 参数实现 per-request 隔离。
   */
  setCustomConfig(config: MergedConstraintsConfig): void {
    this.customConfig = config;
  }

  /**
   * 获取当前的约束集合（内置 + 自定义）
   *
   * @param customConfig 可选，per-request 自定义配置（优先级高于 setCustomConfig 的单例状态）
   */
  getConstraints(customConfig?: MergedConstraintsConfig | null): {
    ironLaws: Record<string, Constraint>;
    guidelines: Record<string, Constraint>;
    tips: Record<string, Constraint>;
  } {
    const config = customConfig ?? this.customConfig;
    if (config) {
      return {
        ironLaws: config.ironLaws,
        guidelines: config.guidelines,
        tips: config.tips,
      };
    }
    return {
      ironLaws: IRON_LAWS,
      guidelines: GUIDELINES,
      tips: TIPS,
    };
  }

  /**
   * 检查单个约束
   */
  async check(
    constraint: Constraint,
    context: ConstraintContext
  ): Promise<ConstraintResult> {
    // 检查例外条件（仅 Guidelines 有效）
    if (constraint.level === 'guideline' && constraint.exceptions) {
      if (this.checkException(constraint, context)) {
        return {
          id: constraint.id,
          level: constraint.level,
          satisfied: true,
          constraint,
          message: `指导原则 ${constraint.id} 因例外条件被豁免`,
          checkedAt: new Date(),
        };
      }
    }

    // 检查前置条件
    const satisfied = await this.checkPrecondition(constraint, context);

    return {
      id: constraint.id,
      level: constraint.level,
      satisfied,
      constraint,
      message: satisfied ? undefined : constraint.message,
      requiredAction: satisfied ? undefined : constraint.enforcement,
      checkedAt: new Date(),
    };
  }

  /**
   * 检查例外条件
   */
  private checkException(constraint: Constraint, context: ConstraintContext): boolean {
    if (!constraint.exceptions) return false;
    return constraint.exceptions.some(
      (ex) => context[EXCEPTION_FIELD_MAP[ex]] === true
    );
  }

  /**
   * 根据约束层级获取严重性
   */
  private getSeverity(level: ConstraintLevel): 'error' | 'warning' | 'info' {
    switch (level) {
      case 'iron_law':
        return 'error';
      case 'guideline':
        return 'warning';
      case 'tip':
        return 'info';
      default:
        return 'warning';
    }
  }

  /**
   * 判断约束是否匹配当前触发条件
   */
  private matchesTrigger(constraint: Constraint, operation: ConstraintTrigger): boolean {
    const triggers = normalizeTriggers<ConstraintTrigger>(constraint.trigger);
    return triggers.includes(operation);
  }

  /**
   * 记录约束检查的 trace
   */
  private recordTrace(
    collector: ReturnType<typeof getTraceCollector>,
    constraint: Constraint,
    checkResult: ConstraintResult,
    context: ConstraintContext
  ): void {
    collector.record({
      constraintId: constraint.id,
      level: constraint.level,
      timestamp: Date.now(),
      result: checkResult.satisfied ? 'pass' : 'fail',
      operation: context.operation,
      severity: this.getSeverity(constraint.level),
      exceptionApplied: checkResult.message?.includes('豁免')
        ? constraint.exceptions?.[0]
        : undefined,
      projectPath: context.projectPath,
      sessionId: context.sessionId,
    });
  }

  /**
   * 检查约束前置条件
   */
  private async checkPrecondition(
    constraint: Constraint,
    context: ConstraintContext
  ): Promise<boolean> {
    const projectPath = context.projectPath || process.cwd();

    switch (constraint.id) {
      // Iron Laws
      case 'no_bypass_checkpoint':
        // 检查代码中是否有 skip/bypass 关键词
        return await this.checkNoBypassCheckpoint(context);

      case 'no_self_approval':
        // 检查是否有测试证据
        return context.hasTest === true;

      case 'no_completion_without_verification':
        // 检查是否有验证证据
        return context.hasVerificationEvidence === true;

      case 'no_test_simplification':
        // 检查是否删除了测试
        return await this.checkNoTestSimplification(projectPath);

      case 'incremental_progress':
        // 检查是否一次做多个任务（需要 context 提供信息）
        // undefined = 未验证 → Iron Law 必须显式确认
        return context.hasSingleTask === true;

      case 'verify_external_capability':
        // 检查是否已验证外部能力
        // undefined = 未验证 → Iron Law 必须显式确认
        return context.hasExternalCapabilityVerification === true;

      case 'no_implementation_without_requirement_review':
        // 检查实现后是否对比需求验证
        return context.hasRequirementReview === true;

      case 'no_implementation_without_requirement':
        // 检查是否有需求文档
        return context.hasRequirement === true;

      case 'must_use_worktree':
        // 检查是否在 worktree 中执行
        return context.hasWorktree === true;

      case 'no_fuzzy_completion_claim':
        // 检查完成声明是否包含模糊词
        return this.checkNoFuzzyWords(context.completionClaimText || '');

      case 'no_performative_agreement':
        // 检查是否有表演性同意（主要由 promptInjection 驱动，这里做辅助检查）
        return this.checkNoPerformativePatterns(context.taskDescription || '');

      case 'two_stage_review_required':
        // 检查是否完成两阶段审查
        return context.hasTwoStageReview === true;

      // Guidelines
      case 'no_fix_without_root_cause':
        // 检查是否有根本原因调查
        return context.hasRootCauseInvestigation === true;

      case 'no_code_without_test':
        // 检查是否有失败的测试
        return context.hasFailingTest === true;

      case 'no_any_type':
        // 检查代码中是否有 any 类型
        return await this.checkNoAnyType(projectPath, context.changedFiles);

      case 'simplest_solution_first':
        // 检查是否已检查本地数据源
        return context.hasReuseCheck === true;

      case 'no_creation_without_reuse_check':
        // 检查是否已进行复用检查
        return context.hasReuseCheck === true;

      case 'capability_sync':
        // 检查 CAPABILITIES.md 是否更新
        return await this.checkCapabilitySync(projectPath);

      case 'no_simplification_without_approval':
        // 检查是否简化了逻辑
        return await this.checkNoSimplificationWithoutApproval(projectPath);

      case 'no_skill_without_test':
        // 检查是否有测试
        return context.hasTest === true;

      case 'test_coverage_required':
        // 检查测试覆盖率
        return await this.checkTestCoverage(projectPath);

      case 'context_doc_sync':
        return await this.checkContextDocSync(projectPath);

      case 'docs_freshness':
        return await this.checkDocsFreshness(projectPath);

      case 'no_excuse_patterns':
        // 检查是否使用了借口模式
        return this.checkNoExcusePatterns(context.completionClaimText || context.taskDescription || '');

      case 'yagni_check':
        // 检查是否有过度设计（主要由 promptInjection 驱动）
        return this.checkYagni(projectPath, context.changedFiles);

      // Tips - 总是返回 true（仅提示）
      case 'readme_required':
        return true;

      case 'doc_required_for_public_api':
        return true;

      default:
        // 未知约束，默认通过
        return true;
    }
  }

  /**
   * 检查文本中是否包含模糊词
   */
  private checkNoFuzzyWords(text: string): boolean {
    if (!text) return true; // 没有文本时默认通过（由其他检查覆盖）
    const fuzzyPatterns = [
      /应该没问题/,
      /应该可以/,
      /大概/,
      /可能/,
      /好像/,
      /似乎/,
      /差不多/,
      /基本完成/,
      /大部分/,
    ];
    return !fuzzyPatterns.some(p => p.test(text));
  }

  /**
   * 检查文本中是否包含表演性同意模式
   */
  private checkNoPerformativePatterns(text: string): boolean {
    if (!text) return true;
    // 检查是否只有"好的/明白了"等同意词，没有后续分析
    const performativeStart = /^(好的[，,]*\s*我[来去]做|明白了[，,]*|没问题[，,]*|ok[，,]*\s*i.?ll)/i;
    // 如果以表演性模式开头，且总长度很短（< 50 字符），视为表演性同意
    if (performativeStart.test(text) && text.length < 100) {
      return false;
    }
    return true;
  }

  /**
   * 检查文本中是否包含借口模式
   */
  private checkNoExcusePatterns(text: string): boolean {
    if (!text) return true;
    const excusePatterns = [
      /稍后修复/,
      /小问题/,
      /不影响功能/,
      /以后再说/,
      /先这样/,
      /临时方案/,
      /暂时这样/,
    ];
    return !excusePatterns.some(p => p.test(text));
  }

  /**
   * 检查 YAGNI：过度设计信号
   *
   * 检查是否存在只有一个实现的 interface/abstract class。
   * 主要由 promptInjection 驱动，这里是辅助检查。
   */
  private async checkYagni(
    projectPath?: string,
    changedFiles?: string[]
  ): Promise<boolean> {
    // 无上下文时默认通过（主要由 promptInjection 驱动）
    if (!projectPath || !changedFiles || changedFiles.length === 0) return true;

    try {
      const path = await import('path');
      const fs = await import('fs');

      for (const file of changedFiles) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;

        const filePath = path.join(projectPath, file);
        if (!fs.existsSync(filePath)) continue;

        const content = fs.readFileSync(filePath, 'utf-8');

        // 检查是否有 export interface/abstract class
        const hasInterface = /export\s+(?:default\s+)?interface\s+(\w+)/g;
        const hasAbstract = /export\s+(?:default\s+)?abstract\s+class\s+(\w+)/g;

        const interfaces = [...content.matchAll(hasInterface)].map(m => m[1]);
        const abstracts = [...content.matchAll(hasAbstract)].map(m => m[1]);

        const exportedTypes = [...interfaces, ...abstracts];

        for (const typeName of exportedTypes) {
          // 检查同一个 typeName 的 implements/extends 出现次数
          const implPattern = new RegExp(`(?:implements|extends)\\s+${typeName}\\b`, 'g');
          // 在整个项目中搜索（简化版：只在 changedFiles 中搜索）
          let implCount = 0;
          for (const f of changedFiles) {
            if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
            const fp = path.join(projectPath, f);
            if (!fs.existsSync(fp)) continue;
            const fc = fs.readFileSync(fp, 'utf-8');
            const matches = fc.match(implPattern);
            if (matches) implCount += matches.length;
          }

          // 只有一个实现者 → YAGNI 违规
          if (implCount <= 1) {
            return false;
          }
        }
      }
    } catch {
      // 文件读取失败，默认通过
      return true;
    }

    return true;
  }

  /**
   * 检查 no_bypass_checkpoint：检查代码中是否有 skip/bypass 关键词
   */
  private async checkNoBypassCheckpoint(context: ConstraintContext): Promise<boolean> {
    const changedFiles = context.changedFiles || [];
    
    if (changedFiles.length === 0) {
      return true; // 无变更文件，默认通过
    }

    // 检查文件内容是否有 skip/bypass 关键词
    const bypassPatterns = [
      /\.skip\(/,          // Jest/Vitest skip
      /\.bypass\s*=/,      // bypass flag
      /skip:\s*true/,      // skip option
      /bypass\s*checkpoint/, // explicit bypass
      /\/\/\s*skip/,       // comment skip
    ];

    for (const file of changedFiles) {
      if (!existsSync(file)) continue;
      try {
        const content = readFileSync(file, 'utf-8');
        for (const pattern of bypassPatterns) {
          if (pattern.test(content)) {
            return false; // 发现 bypass 关键词
          }
        }
      } catch {
        // 文件读取失败，忽略
      }
    }

    return true;
  }

  /**
   * 检查 no_test_simplification：检查 git diff 是否删除了测试
   */
  private async checkNoTestSimplification(projectPath: string): Promise<boolean> {
    try {
      // 检查是否有删除测试的 diff
      const diff = await runCommand('git diff --cached', projectPath);
      
      // 检查是否删除了测试行
      const deletedTestPatterns = [
        /^-\s*(test|it|describe)\s*\(/,  // 删除 test/it/describe
        /^-\s*expect\s*\(/,               // 删除 expect
        /^-\s*\/\/\s*test/,               // 删除注释的 test
      ];

      for (const pattern of deletedTestPatterns) {
        if (pattern.test(diff)) {
          return false; // 发现删除测试
        }
      }

      return true;
    } catch {
      return true; // git 命令失败，默认通过
    }
  }

  /**
   * 检查 no_any_type：grep any 类型
   */
  private async checkNoAnyType(projectPath: string, changedFiles?: string[]): Promise<boolean> {
    try {
      const filesToCheck = changedFiles && changedFiles.length > 0
        ? changedFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
        : [];

      if (filesToCheck.length === 0) {
        return true; // 无 TS 文件变更
      }

      // 检查是否有 : any 类型
      for (const file of filesToCheck) {
        if (!existsSync(file)) continue;
        try {
          const content = readFileSync(file, 'utf-8');
          // 检查 : any（排除注释和字符串）
          const lines = content.split('\n');
          for (const line of lines) {
            // 跳过注释和字符串
            if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
            if (line.includes(': any') && !line.includes('// ') && !line.includes('/*')) {
              return false; // 发现 any 类型
            }
          }
        } catch {
          // 文件读取失败，忽略
        }
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  }

  /**
   * 检查 capability_sync：检查 CAPABILITIES.md 是否与代码同步
   *
   * 两步验证：
   *   1. Git diff 检查 — 当前变更的非测试文件是否在文档中有记录（增量检查）
   *   2. 全量扫描 — src/ 下的所有源文件是否都在 CAPABILITIES.md 中（完整性检查）
   */
  private async checkCapabilitySync(projectPath: string): Promise<boolean> {
    try {
      const capabilitiesPath = join(projectPath, 'CAPABILITIES.md');
      if (!existsSync(capabilitiesPath)) {
        // 检查是否有代码变更，无变更则跳过
        const diff = await runCommand('git diff --cached --name-only', projectPath);
        const changedCodeFiles = diff.split('\n').filter(
          (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')
        );
        return changedCodeFiles.length === 0;
      }

      const listedFiles = this.parseCapabilitiesFiles(capabilitiesPath);

      // ── Step 1: Git diff 增量检查 ──
      const diff = await runCommand('git diff --cached --name-only', projectPath);
      const changedCodeFiles = diff.split('\n').filter(
        (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')
      );

      if (changedCodeFiles.length > 0 && listedFiles.length > 0) {
        const significantChanges = changedCodeFiles.filter(
          (f: string) => !f.includes('__tests__') && !f.includes('.test.') && !f.includes('.spec.')
        );

        if (significantChanges.length > 0) {
          const covered = significantChanges.some((changed: string) =>
            listedFiles.some((listed: string) => changed.endsWith(listed) || changed.includes(listed))
          );
          if (!covered) return false;
        }
      }

      // ── Step 2: 全量 src/ 扫描（T-058 修复核心）──
      // 检查是否有 src/ 下的源文件未在 CAPABILITIES.md 中记录
      if (listedFiles.length > 0) {
        const srcDir = join(projectPath, 'src');
        if (existsSync(srcDir)) {
          // S7: 缓存 src/ 递归扫描结果
          const actualFiles = this.cache.getSync('src_scan', projectPath, () =>
            this.findSourceFiles(srcDir, projectPath)
          );
          for (const file of actualFiles) {
            if (!listedFiles.includes(file)) {
              return false; // 有新增文件未在 CAPABILITIES.md 中列出
            }
          }
        }
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  }

  /**
   * 解析 CAPABILITIES.md 中表格的文件路径列
   */
  private parseCapabilitiesFiles(capabilitiesPath: string): string[] {
    try {
      const content = readFileSync(capabilitiesPath, 'utf-8');
      const files: string[] = [];

      // 匹配 markdown 表格行中的 .ts/.tsx/.js/.jsx 文件路径（第二列）
      const tableRowRegex = /^\|[^|]+\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/gm;
      let match;
      while ((match = tableRowRegex.exec(content)) !== null) {
        files.push(match[1].trim());
      }

      return files;
    } catch {
      return [];
    }
  }

  /**
   * 检查 no_simplification_without_approval：检查简化关键词
   */
  private async checkNoSimplificationWithoutApproval(projectPath: string): Promise<boolean> {
    try {
      const diff = await runCommand('git diff --cached', projectPath);

      // 检查是否有简化关键词
      const simplificationPatterns = [
        /removed\s*test/i,
        /simplified\s*logic/i,
        /removed\s*validation/i,
        /skip\s*check/i,
      ];

      for (const pattern of simplificationPatterns) {
        if (pattern.test(diff)) {
          return false; // 发现简化关键词
        }
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  }

  /**
   * 检查 test_coverage_required：读取 coverage 报告
   */
  private async checkTestCoverage(projectPath: string): Promise<boolean> {
    try {
      // 检查 coverage 报告文件
      const coverageJsonPath = join(projectPath, 'coverage', 'coverage-final.json');
      const coverageSummaryPath = join(projectPath, 'coverage', 'coverage-summary.json');

      if (!existsSync(coverageJsonPath) && !existsSync(coverageSummaryPath)) {
        return true; // 无 coverage 报告，默认通过
      }

      // 尝试读取 coverage-summary.json
      if (existsSync(coverageSummaryPath)) {
        const summary = JSON.parse(readFileSync(coverageSummaryPath, 'utf-8'));
        const total = summary.total || {};
        const linesCoverage = total.lines?.pct || 0;
        
        // 默认要求 50% 覆盖率（可配置）
        return linesCoverage >= 50;
      }

      return true;
    } catch {
      return true; // 检查失败，默认通过
    }
  }

  /**
   * 检查 context_doc_sync：关键目录是否有 CONTEXT.md
   */
  private async checkContextDocSync(projectPath: string): Promise<boolean> {
    try {
      const configPath = join(projectPath, '.harness', 'config.yml');
      const configContent = readFileSync(configPath, 'utf-8');
      const config = yaml.load(configContent) as Record<string, unknown>;
      const governance = config.governance as Record<string, unknown> | undefined;
      const contextFiles = governance?.context_files as Record<string, unknown> | undefined;

      if (!contextFiles?.enabled || !Array.isArray(contextFiles.required_dirs)) {
        return true; // 未配置，跳过
      }

      const requiredDirs = contextFiles.required_dirs as string[];
      for (const dir of requiredDirs) {
        const contextPath = join(projectPath, dir, 'CONTEXT.md');
        if (!existsSync(contextPath)) {
          return false;
        }
      }

      return true;
    } catch {
      return true; // 配置不存在或解析失败，跳过
    }
  }

  /**
   * 检查 docs_freshness：CAPABILITIES.md + CLAUDE.md 是否与源码同步
   */
  private async checkDocsFreshness(projectPath: string): Promise<boolean> {
    // 检查 CAPABILITIES.md
    const capResult = await this.checkCapabilitiesFreshness(projectPath);
    if (!capResult) return false;

    // 检查 CLAUDE.md（Domain Packages + Key Architecture Paths）
    const claudeResult = await this.checkClaudeMdFreshness(projectPath);
    if (!claudeResult) return false;

    return true;
  }

  /**
   * 检查 CAPABILITIES.md 是否与源码同步
   */
  private async checkCapabilitiesFreshness(projectPath: string): Promise<boolean> {
    try {
      const capabilitiesPath = join(projectPath, 'CAPABILITIES.md');
      const content = readFileSync(capabilitiesPath, 'utf-8');

      // 解析 CAPABILITIES.md 中的文件路径
      const listedFiles: string[] = [];
      const tableRowRegex = /^\|[^|]+\|\s*([^|]+?\.(?:ts|tsx|js|jsx))\s*\|/gm;
      let match;
      while ((match = tableRowRegex.exec(content)) !== null) {
        listedFiles.push(match[1].trim());
      }

      // 如果没有表格行，跳过检查
      if (listedFiles.length === 0) {
        return true;
      }

      // 扫描 src/ 目录中的实际文件（S7: 缓存）
      const srcDir = join(projectPath, 'src');
      const actualFiles = this.cache.getSync('src_scan', projectPath, () =>
        this.findSourceFiles(srcDir, projectPath)
      );

      // 检查是否有新增文件未列出
      for (const file of actualFiles) {
        if (!listedFiles.includes(file)) {
          return false; // 有新增文件未列出
        }
      }

      return true;
    } catch {
      return true; // CAPABILITIES.md 不存在或检查失败，跳过
    }
  }

  /**
   * 检查 CLAUDE.md 的 Domain Packages 和 Key Architecture Paths 段落是否与实际代码结构同步
   */
  private async checkClaudeMdFreshness(projectPath: string): Promise<boolean> {
    try {
      const claudePath = join(projectPath, 'CLAUDE.md');
      if (!existsSync(claudePath)) return true; // 无 CLAUDE.md，跳过

      const content = readFileSync(claudePath, 'utf-8');

      // 1. 检查 Domain Packages 段落：packages/studio-* 目录是否存在
      const domainPkgResult = this.checkDomainPackages(projectPath, content);
      if (!domainPkgResult) return false;

      // 2. 检查 Key Architecture Paths 段落：引用的文件/目录是否存在
      const archPathsResult = this.checkArchitecturePaths(projectPath, content);
      if (!archPathsResult) return false;

      return true;
    } catch {
      return true; // 检查失败，跳过
    }
  }

  /**
   * 检查 CLAUDE.md Domain Packages 段落中列出的 packages/studio-* 目录是否都存在
   */
  private checkDomainPackages(projectPath: string, claudeContent: string): boolean {
    try {
      // 提取 Domain Packages 段落内容（到下一个 ## 或 --- 为止）
      const sectionMatch = claudeContent.match(/## Domain Packages\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/);
      if (!sectionMatch) return true; // 段落不存在，跳过

      const section = sectionMatch[1];

      // 提取 CLAUDE.md 中 packages/* 的包名
      const pkgRegex = /packages\/([\w-]+)/g;
      let match;
      while ((match = pkgRegex.exec(section)) !== null) {
        const pkgDir = join(projectPath, 'packages', match[1]);
        if (!existsSync(pkgDir)) {
          return false; // CLAUDE.md 引用的包目录不存在
        }
      }

      // 反向检查：实际存在的包目录是否都在 CLAUDE.md 中被提及
      const packagesDir = join(projectPath, 'packages');
      if (existsSync(packagesDir)) {
        const entries = readdirSync(packagesDir);
        for (const entry of entries) {
          if (entry.startsWith('.') || entry.includes('node_modules')) continue;
          const entryStat = statSync(join(packagesDir, entry));
          if (!entryStat.isDirectory()) continue;
          if (!section.includes(entry)) {
            return false; // 实际包未在 CLAUDE.md 中记录
          }
        }
      }

      return true;
    } catch {
      return true;
    }
  }


  /**
   * 检查 CLAUDE.md Key Architecture Paths 段落中引用的路径是否存在
   */
  private checkArchitecturePaths(projectPath: string, claudeContent: string): boolean {
    try {
      // 提取 Key Architecture Paths 段落
      const sectionMatch = claudeContent.match(/## Key Architecture Paths\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/);
      if (!sectionMatch) return true; // 段落不存在，跳过

      const section = sectionMatch[1];

      // 从表格中提取路径（第二列，格式 `path/to/file.ts` 或 `path/to/dir/`）
      const pathRegex = /\|\s*`([^`]+)`\s*\|/g;
      let match;
      while ((match = pathRegex.exec(section)) !== null) {
        const refPath = match[1].trim();
        // 跳过非路径内容（如命令、URL）
        if (refPath.startsWith('http') || refPath.startsWith('搜')) continue;

        const fullPath = join(projectPath, refPath);
        // 检查文件或目录是否存在（也尝试去掉尾部 /）
        if (!existsSync(fullPath) && !existsSync(fullPath.replace(/\/$/, ''))) {
          // 路径可能指向模块内部（如 `src/modules/example/`），尝试去掉通配符
          const basePath = refPath.replace(/\/?\*$/, '');
          if (!existsSync(join(projectPath, basePath))) {
            return false; // 引用的路径不存在
          }
        }
      }

      return true;
    } catch {
      return true;
    }
  }

  /**
   * 查找 src/ 目录中的源文件
   */
  private findSourceFiles(dir: string, projectPath: string): string[] {
    const results: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      const entryPath = join(dir, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isDirectory()) {
          results.push(...this.findSourceFiles(entryPath, projectPath));
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          results.push(relative(projectPath, entryPath));
        }
      } catch {
        // ignore
      }
    }
    return results;
  }

  /**
   * 查找适用于当前操作的约束
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   */
  findApplicableConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): {
    ironLaws: Constraint[];
    guidelines: Constraint[];
    tips: Constraint[];
  } {
    const trigger = context.operation;
    const constraints = this.getConstraints(customConfig);

    const filterByTrigger = (constraintSet: Record<string, Constraint>): Constraint[] => {
      return Object.values(constraintSet).filter(constraint => {
        const triggers = Array.isArray(constraint.trigger)
          ? constraint.trigger
          : [constraint.trigger];
        return triggers.includes(trigger);
      });
    };

    return {
      ironLaws: filterByTrigger(constraints.ironLaws),
      guidelines: filterByTrigger(constraints.guidelines),
      tips: filterByTrigger(constraints.tips),
    };
  }

  /**
   * 执行三层约束检查
   *
   * - Iron Laws：检查失败立即抛出异常
   * - Guidelines：检查失败记录警告
   * - Tips：检查失败记录提示
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   */
  async checkConstraints(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): Promise<ConstraintCheckResult> {
    const result: ConstraintCheckResult = {
      ironLaws: [],
      guidelines: [],
      tips: [],
      passed: true,
      warningCount: 0,
      tipCount: 0,
    };

    const traceCollector = getTraceCollector();
    const constraints = this.getConstraints(customConfig);

    // 1. Iron Laws: 必须全部通过
    for (const constraint of Object.values(constraints.ironLaws)) {
      if (!this.matchesTrigger(constraint, context.operation)) continue;

      const checkResult = await this.check(constraint, context);
      result.ironLaws.push(checkResult);
      this.recordTrace(traceCollector, constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.passed = false;
        throw new ConstraintViolationError(checkResult);
      }
    }

    // 2. Guidelines: 记录警告
    for (const constraint of Object.values(constraints.guidelines)) {
      if (!this.matchesTrigger(constraint, context.operation)) continue;

      const checkResult = await this.check(constraint, context);
      result.guidelines.push(checkResult);
      this.recordTrace(traceCollector, constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.warningCount++;
      }
    }

    // 3. Tips: 仅记录
    for (const constraint of Object.values(constraints.tips)) {
      if (!this.matchesTrigger(constraint, context.operation)) continue;

      const checkResult = await this.check(constraint, context);
      result.tips.push(checkResult);
      this.recordTrace(traceCollector, constraint, checkResult, context);

      if (!checkResult.satisfied) {
        result.tipCount++;
      }
    }

    return result;
  }

  /**
   * 执行前检查（仅检查 Iron Laws）
   *
   * @param context 约束上下文
   * @param customConfig 可选，per-request 自定义配置（避免多请求间的单例状态污染）
   * @throws ConstraintViolationError 如果有铁律违规
   */
  async beforeExecution(
    context: ConstraintContext,
    customConfig?: MergedConstraintsConfig | null
  ): Promise<void> {
    const constraints = this.getConstraints(customConfig);
    const operations = normalizeTriggers(context.operation);

    for (const constraint of Object.values(constraints.ironLaws)) {
      if (!normalizeTriggers(constraint.trigger).some((t) => operations.includes(t))) continue;

      const result = await this.check(constraint, context);
      if (!result.satisfied) {
        throw new ConstraintViolationError(result);
      }
    }
  }
}

// ========================================
// 快捷函数
// ========================================

/**
 * 快捷函数：检查约束
 */
export async function checkConstraint(
  constraintId: string,
  context: ConstraintContext
): Promise<ConstraintResult> {
  const checker = ConstraintChecker.getInstance();
  const constraints = checker.getConstraints();

  const constraint =
    constraints.ironLaws[constraintId] ||
    constraints.guidelines[constraintId] ||
    constraints.tips[constraintId];

  if (!constraint) {
    return {
      id: constraintId,
      level: 'tip',
      satisfied: false,
      message: `未知的约束: ${constraintId}`,
      checkedAt: new Date(),
    };
  }

  return checker.check(constraint, context);
}

/**
 * 快捷函数：执行三层检查
 *
 * @param context 约束上下文
 * @param customConfig 可选，per-request 自定义配置
 */
export async function checkConstraints(
  context: ConstraintContext,
  customConfig?: MergedConstraintsConfig | null
): Promise<ConstraintCheckResult> {
  return ConstraintChecker.getInstance().checkConstraints(context, customConfig);
}

/**
 * 快捷函数：执行前检查
 *
 * @param context 约束上下文
 * @param customConfig 可选，per-request 自定义配置
 */
export async function checkBeforeExecution(
  context: ConstraintContext,
  customConfig?: MergedConstraintsConfig | null
): Promise<void> {
  return ConstraintChecker.getInstance().beforeExecution(context, customConfig);
}

/**
 * 构建约束注入 prompt
 *
 * 收集所有适用约束的 promptInjection 字段，格式化为 Agent system prompt 片段。
 * 纯计算函数，无副作用，不调用 LLM。
 *
 * @param context 约束上下文（至少需要 operation 字段）
 * @returns 格式化的约束提示文本，可直接注入 Agent system prompt；无匹配约束时返回空字符串
 */
export function buildConstraintPrompt(context: ConstraintContext): string {
  const constraints = findConstraintsByTrigger(context.operation);
  const injections = constraints
    .filter(c => c.promptInjection)
    .map(c => c.promptInjection!);

  if (injections.length === 0) return '';

  const lines: string[] = [
    '## 行为约束（你必须遵守）',
    '',
    ...injections.map((text, i) => `${i + 1}. ${text}`),
    '',
  ];

  return lines.join('\n');
}

// 导出单例
export const constraintChecker = ConstraintChecker.getInstance();

// ========================================
// 向后兼容的类和函数
// ========================================

/**
 * @deprecated 使用 ConstraintChecker 代替
 */
export const IronLawChecker = ConstraintChecker;

/**
 * @deprecated 使用 checkConstraint 代替
 */
export async function checkIronLaw(
  lawId: string,
  context: ConstraintContext
): Promise<ConstraintResult> {
  return checkConstraint(lawId, context);
}

/**
 * @deprecated 使用 checkConstraints 代替
 */
export async function checkAllIronLaws(
  context: ConstraintContext
): Promise<ConstraintResult[]> {
  const result = await checkConstraints(context);
  return [...result.ironLaws, ...result.guidelines, ...result.tips];
}

/**
 * @deprecated 使用 constraintChecker 代替
 */
export const ironLawChecker = constraintChecker;
