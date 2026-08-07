/**
 * 约束定义拆分文件（工单 20）：原 definitions.ts 按层拆分，
 * definitions.ts 保持原路径做薄聚合（studio rule-scanner 契约）。
 */

import type { Constraint } from '../../../types/constraint';

// ========================================
// IRON LAWS（铁律）
// 
// 定义：绝对禁止，无例外，违背即阻止执行
// ========================================

export const IRON_LAWS: Record<string, Constraint> = {
  /**
   * 禁止跳过检查点验证
   * 原因：安全底线，检查点是质量门控
   */
  no_bypass_checkpoint: {
    id: 'no_bypass_checkpoint',
    rule: 'NO BYPASSING CHECKPOINTS',
    message: '禁止跳过检查点验证',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'checkpoint-required',
    description: '所有检查点必须通过，不能跳过验证步骤。检查点是质量的最后一道防线。',
    promptInjection: '每个关键步骤后有 checkpoint 验证点，必须通过才能继续。通过标准：测试通过、类型检查无错误、lint 无新增警告。未通过时回退修复，不得跳过。',
  },

  /**
   * 禁止自评通过
   * 原因：质量底线，必须有测试证据
   */
  no_self_approval: {
    id: 'no_self_approval',
    rule: 'NO SELF APPROVAL WITHOUT TEST EVIDENCE',
    message: '禁止自评通过，必须提供测试证据',
    level: 'iron_law',
    trigger: 'task_completion_claim',
    enforcement: 'passes-gate',
    description: '任务完成声明必须基于真实测试结果，不能由开发者自评。测试证据包括：测试报告、覆盖率数据、CI 通过记录。',
    promptInjection: '声明任务完成时，必须提供可验证的测试证据（测试报告、覆盖率数据、CI 通过记录），不得仅凭自己的判断声称完成。',
  },

  /**
   * 禁止无验证声明完成
   * 原因：质量底线，必须有验证命令
   */
  no_completion_without_verification: {
    id: 'no_completion_without_verification',
    rule: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE',
    message: '禁止无验证声明完成，必须运行验证命令',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'verify-completion',
    description: '在声明任何任务完成之前，必须运行新鲜的、完整的验证命令。验证命令包括：npm test、npm run build、CI 流程。',
    promptInjection: '在声明任务完成前，必须重新运行完整的验证命令（npm test、npm run build、type check），使用新鲜的输出作为完成证据，不得复用旧结果。',
  },

  /**
   * 禁止简化测试
   * 原因：质量底线，测试困难必须解决
   */
  no_test_simplification: {
    id: 'no_test_simplification',
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
   * 禁止一次做多个任务（one-shotting）
   * 来源：Anthropic AI Harness - Effective Harnesses for Long-running Agents
   * 原因：避免中途耗尽 context，保持专注和可控
   */
  incremental_progress: {
    id: 'incremental_progress',
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
   * 禁止实现未验证的外部依赖能力
   * 原因：假设外部系统能力存在，实现后发现不支持，浪费开发时间
   */
  verify_external_capability: {
    id: 'verify_external_capability',
    rule: 'VERIFY EXTERNAL CAPABILITY BEFORE IMPLEMENTATION',
    message: '外部依赖能力必须先验证',
    level: 'iron_law',
    trigger: 'api_change',
    enforcement: 'capability-verification',
    description: `实现方案依赖外部系统的未确认能力时，必须先验证。

【触发条件】（满足任一）
- 依赖外部 API/服务的回调/交互机制
- 使用未验证过的外部系统高级功能
- 假设外部系统支持某种能力但未查阅文档

【必须执行】
1. 查阅官方文档 → 确认能力是否存在
2. 发送最小测试 → 验证可行性
3. 记录限制 → 作为设计约束

【不触发】
- 内部逻辑实现
- 已熟悉的库/框架基本功能
- 标准 CRUD 操作

【案例】
- 假设外部 API 支持某种交互模式
- 未查阅官方文档的限制说明
- 实现完整功能后才发现不支持
- 浪费开发时间，需要重新设计方案

【正确流程】
设计方案 → 查阅文档限制 → 发送最小测试 → 验证可行 → 开发`,
    promptInjection: '实现方案依赖外部 API/服务未确认的能力时，必须先查阅官方文档确认能力存在，再发送最小测试验证可行性，记录限制作为设计约束。不要假设外部系统支持某种能力就直接开发。',
  },

  /**
   * 实现后必须对比需求验证
   * 原因：避免实现偏离需求
   */
  no_implementation_without_requirement_review: {
    id: 'no_implementation_without_requirement_review',
    rule: 'REVIEW IMPLEMENTATION AGAINST REQUIREMENTS',
    message: '实现后必须对比需求验证',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'requirement-review',
    description: `实现完成后，必须对比原始需求进行验证。

【触发条件】
- 功能开发完成
- Bug 修复完成
- 重构完成

【必须执行】
1. 回顾需求文档（Spec/Roadmap/Issue）
2. 检查实现是否符合每条 AC
3. 确认边界情况已覆盖
4. 输出验证清单

【禁止】
- 实现后不对比需求直接提交
- 只测试"功能能跑"不验证 AC
- 跳过边界情况验证
- 假设"差不多就行"

【验证清单模板】
| AC | 实现 | 状态 |
|----|------|:----:|
| AC-001 | xxx | ✅ |
| AC-002 | xxx | ✅ |

【案例】
- 需求：事件触发后自动创建关联资源
- 实现：增加了自动关联逻辑
- 验证：✅ 检查了 Spec 定义、测试了多种场景`,
    promptInjection: '实现完成后，必须逐条对比原始需求文档（Spec/Issue/Roadmap）中的验收标准(AC)，确认每条 AC 已实现且边界情况已覆盖，输出验证清单。不得仅凭"功能能跑"就认为完成。',
  },

  /**
   * 禁止无需求就开始实现
   * 原因：没有需求就没有验收标准，实现方向不可控
   */
  no_implementation_without_requirement: {
    id: 'no_implementation_without_requirement',
    rule: 'NO IMPLEMENTATION WITHOUT REQUIREMENTS',
    message: '禁止无需求就开始实现',
    level: 'iron_law',
    trigger: ['code_implementation', 'design_request'],
    enforcement: 'requirement-exists',
    description: `在开始实现之前，必须有明确的需求定义。

【触发条件】
- 开始编写业务代码
- 开始开发新功能

【必须执行】
1. 确认需求来源（Spec/Issue/Roadmap/用户指令）
2. 确认验收标准（AC）已定义
3. 确认边界情况已明确

【禁止】
- 没有需求就开始写代码
- 假设"用户想要什么"就开始实现
- 跳过需求确认直接开发

【正确流程】
需求确认 → AC 定义 → 实现 → 验证`,
    promptInjection: '开始编写代码前，必须确认：需求来源明确（Spec/Issue/Roadmap/用户指令）、验收标准(AC)已定义、边界情况已明确。不要凭假设或猜测开始实现。',
  },

  /**
   * 禁止模糊完成声明
   * 原因：质量底线，必须有可量化证据
   * 来源：Superpowers no_fuzzy_completion_claim
   */
  no_fuzzy_completion_claim: {
    id: 'no_fuzzy_completion_claim',
    rule: 'NO FUZZY COMPLETION CLAIMS WITHOUT QUANTIFIABLE EVIDENCE',
    message: '禁止模糊完成声明，必须提供可量化证据',
    level: 'iron_law',
    trigger: ['code_implementation', 'design_request'],
    enforcement: 'fuzzy-check',
    description: `声明任务完成时，禁止使用模糊词语。必须提供具体、可量化的验证结果。

【禁止的模糊词】
- "应该没问题"、"大概完成了"、"可能可以了"
- "好像通过了"、"似乎工作正常"、"应该能跑"
- "基本完成"、"差不多"、"大部分功能可用"
- "我记得删过了"、"之前说删了"、"已删除"（未经 ls/grep 验证）
- "大部分实现"（未经逐 AC 对照 spec）
- "已修复"（未经 test 验证）

【必须提供】
- 测试通过的精确数量（如 "142 tests passed"）
- 验证命令输出（如 "npm test 全部通过"）
- 删除操作后 ls 确认（如 "ls packages/dead-pkg → No such file"）
- Spec AC 对照表（逐项标注 pass/fail）`,
    promptInjection: '声明任务完成时，禁止使用模糊词语。必须提供具体的测试通过数量、覆盖率数据和验证命令输出来证明任务真的完成了。声明"已删除"前必须用 ls 确认文件不存在。声明 spec 完成前必须逐 AC 对照。',
  },

  /**
   * 禁止表演性同意
   * 原因：同意不等于理解，必须先分析再确认
   * 来源：Superpowers no_performative_agreement
   */
  no_performative_agreement: {
    id: 'no_performative_agreement',
    rule: 'NO PERFORMATIVE AGREEMENT WITHOUT ANALYSIS',
    message: '禁止表演性同意，必须先分析再确认',
    level: 'iron_law',
    trigger: ['design_request'],
    enforcement: 'performative-check',
    description: `收到需求或反馈时，不能仅表示"好的"、"明白了"就直接执行。必须先分析、复述理解、确认一致。

【禁止模式】
- "好的，我来做" → 无分析直接行动
- "明白了" → 没有复述理解
- "没问题" → 没有提出疑问

【必须步骤】
1. 复述你对需求的理解
2. 提出潜在的疑问或边界情况
3. 说明你的实现方案
4. 确认理解一致后再行动`,
    promptInjection: '先思后码。明确声明前提假设。遇不确定先提问而非猜测。存在歧义时列出多种理解路径。若存在更简方案应果断提出异议。收到需求时：①复述理解 ②提出疑问 ③说明方案 ④确认一致。',
  },

  /**
   * 必须两阶段审查
   * 原因：先验证规范合规，再检查代码质量，防止规范偏差
   * 来源：Superpowers two_stage_review_required
   */
  two_stage_review_required: {
    id: 'two_stage_review_required',
    rule: 'REVIEW MUST COVER SPEC COMPLIANCE BEFORE CODE QUALITY',
    message: '审查必须两阶段：先验证规范合规，再检查代码质量',
    level: 'iron_law',
    trigger: 'code_implementation',
    enforcement: 'two-stage-review',
    description: `代码审查必须分两阶段进行：

【Stage 1: 规范合规审查】
- 逐条对照验收标准(AC)验证
- 重新运行 Executor 的测试，确认通过
- 审计测试质量（是否只测了 happy path）
- 补写边界条件测试，验证是否失败

【Stage 2: 代码质量审查】
- 仅在 Stage 1 全部通过后进入
- 安全性检查（注入、泄露、权限）
- 可读性检查（命名、结构、DRY）
- 类型安全（type check、lint）`,
    promptInjection: '代码审查必须分两阶段：① 规范合规审查 — 逐条对照验收标准(AC)验证实现是否满足需求，重新运行测试，审计测试质量并补写边界用例；② 代码质量审查 — 仅在 Stage 1 全部通过后，检查安全性、可读性、类型安全。Stage 1 不通过则不得进入 Stage 2。',
  },

  /**
   * 文档新鲜度 — 升级为 Iron Law (2026-05-19)
   * 原因：guideline 只警告不阻断，导致文档持续腐烂。
   */
  docs_freshness: {
    id: 'docs_freshness',
    rule: 'CAPABILITIES.MD MUST BE IN SYNC WITH CODE',
    message: 'CAPABILITIES.md 与源码不同步，运行 harness sync-docs 更新后重新提交',
    level: 'iron_law',
    trigger: ['file_modification', 'module_creation', 'module_modification'],
    enforcement: 'docs-sync-check',
    description: `CAPABILITIES.md 中列出的文件必须在 src/ 中实际存在。删除源文件时须从 CAPABILITIES.md 同步移除。运行 harness sync-docs 自动修复过期引用。
注: CONTEXT.md 已删除。目录描述集中在 CLAUDE.md Key Subsystems 表中。新增文件全覆盖检查待 sync-docs 完善后启用。`,
  },
};
