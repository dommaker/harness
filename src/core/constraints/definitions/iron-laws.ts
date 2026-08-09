/**
 * check · iron_law 定义（ADR-0001：kind 二元模型）
 *
 * 只保留带真实 checker 的铁律。每条必须：
 * - kind: 'check'
 * - level: 'iron_law'
 * - 在 checkers/ 注册表中有对应实现（注册表闭环，缺失即加载期抛错）
 */

import type { Constraint } from '../../../types/constraint';

export const IRON_LAWS: Record<string, Constraint> = {
  /**
   * 禁止无验证声明完成
   * 原因：质量底线，必须有验证命令
   */
  no_completion_without_verification: {
    id: 'no_completion_without_verification',
    kind: 'check',
    rule: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE',
    message: '禁止无验证声明完成，必须运行验证命令',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'verify-completion',
    description: '在声明任何任务完成之前，必须运行新鲜的、完整的验证命令。验证命令包括：npm test、npm run build、CI 流程。',
    promptInjection: '在声明任务完成前，必须重新运行完整的验证命令（npm test、npm run build、type check），使用新鲜的输出作为完成证据，不得复用旧结果。',
  },

  /**
   * 禁止一次做多个任务（one-shotting）
   * 来源：Anthropic AI Harness - Effective Harnesses for Long-running Agents
   * 原因：避免中途耗尽 context，保持专注和可控
   */
  incremental_progress: {
    id: 'incremental_progress',
    kind: 'check',
    rule: 'ONE TASK PER SESSION',
    message: '禁止一次做多个任务，每次只做一件事',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'single-task-check',
    description: `一个 session 只处理一个任务，避免 one-shotting。

【禁止】
- 一次做多个任务 → 中途耗尽 context
- 大改动一次性完成 → 失控
- 没有拆分的复杂任务 → 无法回滚

【必须】
- 一个 session 一个任务 → 保持专注
- 大任务拆分为小步骤 → 分步执行
- 每步都有 checkpoint → 可回滚

【判断标准】
- 改动涉及多个模块 → 需拆分
- 改动超过 100 行 → 需拆分
- 改动影响多个文件 → 需拆分

【参考】
Anthropic AI: "Effective Harnesses for Long-running Agents"
https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`,
    promptInjection: '一次只处理一个任务。改动涉及多个模块、超过 100 行、或影响多个文件时，必须拆分为小步骤分步执行，每步有独立 checkpoint 可回滚。不要试图一次性完成所有改动。',
  },

  /**
   * 禁止无需求就开始实现（吸收 no_implementation_without_requirement_review）
   * 原因：没有需求就没有验收标准，实现方向不可控；
   *       实现完成后必须逐条对照 AC 验证，避免偏离需求
   */
  no_implementation_without_requirement: {
    id: 'no_implementation_without_requirement',
    kind: 'check',
    rule: 'NO IMPLEMENTATION WITHOUT REQUIREMENTS, AND REVIEW AGAINST AC AFTER IMPLEMENTATION',
    message: '禁止无需求就开始实现，实现后必须逐条对照 AC 验证',
    level: 'iron_law',
    trigger: ['code_implementation', 'design_request'],
    enforcement: 'requirement-exists',
    description: `在开始实现之前，必须有明确的需求定义；实现完成后，必须逐条对照验收标准（AC）验证。

【实现前必须执行】
1. 确认需求来源（Spec/Issue/Roadmap/用户指令）
2. 确认验收标准（AC）已定义
3. 确认边界情况已明确

【实现后必须执行】（吸收自 no_implementation_without_requirement_review）
1. 回顾需求文档（Spec/Roadmap/Issue）
2. 逐条检查实现是否符合每条 AC
3. 确认边界情况已覆盖
4. 输出验证清单（AC × 实现 × 状态）

【禁止】
- 没有需求就开始写代码、凭假设开始实现
- 实现后不对比需求直接提交，只测"功能能跑"不验证 AC
- 跳过边界情况验证，假设"差不多就行"

【正确流程】
需求确认 → AC 定义 → 实现 → 逐条对照 AC 验证`,
    promptInjection: '开始编写代码前，必须确认：需求来源明确（Spec/Issue/Roadmap/用户指令）、验收标准(AC)已定义、边界情况已明确。不要凭假设或猜测开始实现。实现完成后，必须逐条对比原始需求文档中的验收标准(AC)，确认每条 AC 已实现且边界情况已覆盖，输出验证清单。不得仅凭"功能能跑"就认为完成。',
  },

  /**
   * 禁止简化测试
   * 原因：质量底线，测试困难必须解决
   */
  no_test_simplification: {
    id: 'no_test_simplification',
    kind: 'check',
    rule: 'NO SIMPLIFYING TESTS TO AVOID DIFFICULTY',
    message: '禁止简化测试绕过困难',
    level: 'iron_law',
    trigger: 'test_creation',
    enforcement: 'full-test-coverage',
    description: `在编写测试时，不能因为遇到困难而简化或跳过测试。

遇到测试困难时：
1. 分析问题：是 mock 问题？异步问题？环境问题？
2. 尝试解决：查阅文档、搜索解决方案
3. 请求帮助：向用户说明困难，请求指示

禁止：
- 为了绕过 mock 困难而删除测试用例
- 为了绕过异步问题而跳过断言
- 降低测试覆盖率要求`,
    promptInjection: '编写测试时遇到困难（mock、异步、环境），不得删除用例或跳过断言。正确做法：分析问题 → 查阅文档 → 尝试解决 → 仍不行则向用户说明困难请求指示。不得降低覆盖率要求。',
  },

  /**
   * 文档新鲜度
   * 原因：guideline 只警告不阻断，导致文档持续腐烂。
   */
  docs_freshness: {
    id: 'docs_freshness',
    kind: 'check',
    rule: 'CAPABILITIES.MD MUST BE IN SYNC WITH CODE',
    message: 'CAPABILITIES.md 与源码不同步，运行 harness sync-docs 更新后重新提交',
    level: 'iron_law',
    trigger: ['file_modification', 'module_creation', 'module_modification'],
    enforcement: 'docs-sync-check',
    description: `CAPABILITIES.md 中列出的文件必须在 src/ 中实际存在。删除源文件时须从 CAPABILITIES.md 同步移除。运行 harness sync-docs 自动修复过期引用。
注: CONTEXT.md 已删除。目录描述集中在 CLAUDE.md Key Subsystems 表中。新增文件全覆盖检查待 sync-docs 完善后启用。`,
  },
};
