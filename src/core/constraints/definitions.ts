/**
 * 约束定义
 * 
 * 三层约束体系：
 * - IRON_LAWS：绝对禁止，无例外
 * - GUIDELINES：优先建议，有例外
 * - TIPS：信息性提示
 */

import type { Constraint, ConstraintTrigger } from '../../types/constraint';

// 导出兼容类
export { IronLawViolationError } from '../../types/constraint';

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
   * 必须在 worktree 中开发
   * 原因：隔离工作区，安全回滚，并行开发
   * 来源：Superpowers must_use_worktree
   */
  must_use_worktree: {
    id: 'must_use_worktree',
    rule: 'CODE CHANGES MUST BE ISOLATED IN A WORKTREE',
    message: '代码开发必须在隔离的 worktree 中进行',
    level: 'iron_law',
    trigger: ['code_implementation'],
    enforcement: 'check-worktree',
    description: `所有代码修改必须在隔离的 worktree 中进行，不要在原始仓库目录直接编辑。

【原因】
- 隔离风险：worktree 中的改动不会影响主工作区
- 安全回滚：删除 worktree 即可放弃改动
- 并行开发：多个任务可同时在不同 worktree 中进行

【禁止】
- 在原始仓库目录直接编辑文件
- 跳过 worktree 创建直接执行 Agent`,
    promptInjection: '所有代码修改必须在隔离的 worktree 中进行。不要在原始仓库目录直接编辑文件。worktree 提供了安全回滚和并行开发能力。如果你发现不在 worktree 中，立即停止并要求创建 worktree。',
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

// ========================================
// GUIDELINES（指导原则）
// 
// 定义：优先建议，有例外，违背发警告但不阻止
// ========================================

export const GUIDELINES: Record<string, Constraint> = {
  /**
   * 禁止无调查修复 bug
   * 例外：简单 typo、配置错误
   */
  no_fix_without_root_cause: {
    id: 'no_fix_without_root_cause',
    rule: 'NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST',
    message: '复杂 bug 必须先调查根本原因',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'debug-systematic',
    description: `在尝试修复 bug 之前，按复杂度区分调查要求：

[复杂 bug - 必须系统性调查]
- 业务逻辑错误（需追踪数据流）
- 状态不一致（需分析状态变化链）
- 性能问题（需定位瓶颈）
- 多模块联动问题（需分析调用链）

[简单 bug - 快速确认即可]
- typo/拼写错误
- 配置值错误
- 缺少必要配置

[禁止]
- 没有任何调查就直接猜测修复
- 看到 error 就直接 try-catch 掩盖`,
    exceptions: ['simple_typo', 'config_value_error', 'missing_config'],
  },

  /**
   * 业务逻辑代码必须先写测试
   * 例外：配置文件、类型定义
   */
  no_code_without_test: {
    id: 'no_code_without_test',
    rule: 'PRODUCTION LOGIC CODE MUST HAVE TESTS FIRST',
    message: '业务逻辑代码必须先写测试',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'tdd-cycle',
    description: `在编写代码时，按类型区分测试要求：

[必须先写测试]
- 业务逻辑代码（算法、计算、数据处理）
- 工具函数（可复用的独立函数）
- API 接口（输入输出验证）
- 核心组件（影响系统行为的组件）

[不强制测试]
- 配置文件（config、env）
- 类型定义文件（.d.ts、interface）
- 简单 getter/setter
- 纯展示 UI 组件（无交互逻辑）`,
    exceptions: ['config_file', 'type_definition', 'simple_accessor', 'pure_display_component'],
  },

  /**
   * 避免 any 类型
   * 例外：JSON.parse、第三方库无类型
   */
  no_any_type: {
    id: 'no_any_type',
    rule: 'AVOID ANY TYPE, USE UNKNOWN OR SPECIFIC TYPES',
    message: '避免 any 类型',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'type-safe',
    description: `TypeScript 代码中应避免使用 any 类型：

[推荐做法]
- 使用 unknown + 类型守卫
- 使用具体类型定义
- 使用泛型约束

[允许例外] 但需添加注释说明
- JSON.parse/JSON.stringify 结果
- 第三方库无类型定义
- 迁移遗留代码临时使用`,
    exceptions: ['json_parse_result', 'third_party_no_types', 'legacy_migration'],
  },

  /**
   * 简单方案优先
   * 例外：扩展性、安全性、性能需求
   */
  simplest_solution_first: {
    id: 'simplest_solution_first',
    rule: 'CHECK LOCAL/SIMPLE OPTIONS BEFORE REMOTE/COMPLEX',
    message: '先检查本地/简单方案',
    level: 'guideline',
    trigger: ['code_implementation', 'module_extension'],
    enforcement: 'check-local-first',
    description: `在实现功能时，必须按顺序检查：
1) 是否有本地数据源（内存/文件）？
2) 是否有更简单的方案（更少依赖/更少代码）？
3) 如需远程查询/复杂架构，必须说明理由。

例外情况（可跳过简单方案）：
- scalability_required: 需要多实例/分布式部署
- security_required: 需要加密/鉴权等安全措施
- performance_required: 本地方案性能不足
- reliability_required: 需要持久化/高可用`,
    exceptions: ['scalability_required', 'security_required', 'performance_required', 'reliability_required'],
    promptInjection: '简单至上：仅用最少代码解决问题。不添加"以防万一"的冗余功能。不为仅用一次的代码强行设计抽象。自检：资深工程师是否会认为此实现过度复杂？若是，立即简化。',
    injectPrompt: true,
  },

  /**
   * 复用检查优先
   * 例外：紧急修复、hotfix、安全补丁
   */
  no_creation_without_reuse_check: {
    id: 'no_creation_without_reuse_check',
    rule: 'NO NEW CAPABILITIES WITHOUT REUSE CHECK FIRST',
    message: '创建新能力前必须检查复用',
    level: 'guideline',
    trigger: [
      'module_creation',
      'module_creation',
      'module_creation',
      'module_creation',
      'module_extension',
      'code_implementation',
    ],
    enforcement: 'reuse-first',
    description: `在创建新能力之前，必须先执行复用检查：

1. 查询现有能力索引
2. 检查是否有功能相似的能力
3. 评估是否可以复用或扩展
4. 记录复用检查结果

复用优先级：
1. 直接复用现有能力
2. 扩展现有能力
3. 组合多个现有能力
4. 创建新能力

例外情况下可跳过，但必须记录跳过原因。`,
    exceptions: ['emergency_fix', 'hotfix', 'security_patch'],
  },

  /**
   * 功能清单同步
   * 例外：内部重构、bug fix
   */
  capability_sync: {
    id: 'capability_sync',
    rule: 'CODE CHANGES MUST UPDATE CAPABILITIES.MD',
    message: '核心模块变更必须同步功能清单',
    level: 'guideline',
    trigger: ['module_creation', 'module_modification', 'module_deletion', 'module_extension'],
    enforcement: 'update-capabilities',
    description: `在创建/修改/删除/扩展核心模块时，必须同步更新 CAPABILITIES.md：

[必须更新]
- 新增模块/功能
- 修改模块对外接口
- 删除模块/功能
- 扩展模块能力

[不强制更新]
- 内部重构不影响对外接口
- bug fix 不改变功能
- 性能优化不改变接口`,
    exceptions: ['internal_refactor', 'bug_fix_only', 'performance_optimization'],
  },

  /**
   * 禁止砍功能
   * 例外：冗余代码清理
   */
  no_simplification_without_approval: {
    id: 'no_simplification_without_approval',
    rule: 'NO SIMPLIFYING LOGIC WITHOUT USER APPROVAL',
    message: '禁止砍功能，合理重构除外',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'preserve-complexity',
    description: `在实现或修改代码时，区分简化类型：

[禁止] 必须向用户说明并获取批准
- 为了赶进度砍掉必要功能
- 为了省事跳过边界条件处理
- 为了简化逻辑牺牲用户体验

[允许] 合理优化，不需要批准
- 发现冗余代码后的重构优化
- 用更简洁的实现达到相同效果
- 删除不再使用的遗留代码`,
    exceptions: ['redundant_code_cleanup', 'same_effect_refactor', 'unused_code_removal'],
  },

  /**
   * 技能需要测试
   * 例外：MVP
   */
  no_skill_without_test: {
    id: 'no_skill_without_test',
    rule: 'NO SKILL WITHOUT A FAILING TEST FIRST',
    message: '创建技能前必须先定义测试场景',
    level: 'guideline',
    trigger: 'module_creation',
    enforcement: 'skill-test-scenario',
    description: `在创建新的 agent 技能之前，必须先定义测试场景：

1. 定义输入/输出期望
2. 定义边界条件
3. 定义失败场景
4. 编写测试用例

测试场景帮助：
- 明确技能的功能边界
- 验证技能的正确性
- 防止回归`,
  },

  /**
   * 测试覆盖率要求
   * 例外：遗留代码
   */
  test_coverage_required: {
    id: 'test_coverage_required',
    rule: 'TEST COVERAGE MUST MEET REQUIREMENTS',
    message: '测试覆盖率必须达到要求',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'check-coverage',
    description: `在提交代码前，测试覆盖率必须达到项目要求（默认 80%）。

检查命令：
- npm run test:coverage
- 查看覆盖率报告

提升覆盖率：
- 为未覆盖的分支添加测试
- 为边界条件添加测试`,
  },

  /**
   * 设计决策需先讨论
   * 例外：明确指令、紧急修复、已有设计文档
   */
  design_decision_requires_discussion: {
    id: 'design_decision_requires_discussion',
    rule: 'DESIGN DECISIONS MUST BE DISCUSSED BEFORE IMPLEMENTATION',
    message: '设计决策类任务需先讨论方案再实现',
    level: 'guideline',
    trigger: ['design_request', 'architecture_change', 'code_implementation'],
    enforcement: 'require-discussion',
    description: `当用户问"怎么实现"、"设计方案"时，应先：

1. 提供方案选项（至少 2 个）
   - 方案 A: ...（优点/缺点）
   - 方案 B: ...（优点/缺点）

2. 说明推荐方案和理由

3. 让用户选择或确认

4. 用户确认后再实现

[判断标准]
- 用户问"怎么实现"、"如何设计" → 设计决策
- 用户说"帮我做 xxx" → 执行任务

[例外]
- 用户明确说"直接做"、"不用问"
- 紧急修复
- 已有明确设计文档`,
    exceptions: ['explicit_instruction', 'emergency_fix', 'existing_design'],
  },

  /**
   * 覆盖率不能下降
   * 例外：删除测试、重构核心逻辑
   */
  no_coverage_decrease: {
    id: 'no_coverage_decrease',
    rule: 'COVERAGE MUST NOT DECREASE ON NEW COMMITS',
    message: '新提交不能降低测试覆盖率',
    level: 'guideline',
    trigger: 'commit',
    enforcement: 'coverage-gate',
    description: `每次提交代码时，测试覆盖率不能低于上一次提交：

[检查方式]
- Git pre-commit hook 运行覆盖率检查
- GitHub Actions 在 PR 时验证
- 对比上一次覆盖率报告

[阈值要求]
- Statements ≥ 85%
- Branches ≥ 75%
- Functions ≥ 80%
- Lines ≥ 85%

[例外]
- 删除废弃功能
- 重构核心逻辑（需评审）
- 紧急修复（需后续补测）`,
    exceptions: ['deprecated_removal', 'core_refactor_with_review', 'emergency_fix_pending_test'],
  },

  /**
   * 关键目录需要 CONTEXT.md
   * 例外：临时目录、测试目录、生成代码目录
   */
  context_doc_sync: {
    id: 'context_doc_sync',
    rule: 'KEY DIRECTORIES SHOULD HAVE CONTEXT.MD',
    message: '关键目录缺少 CONTEXT.md，运行 harness sync-docs 创建模板后填写实际内容',
    level: 'guideline',
    trigger: 'module_modification',
    enforcement: 'context-check',
    description: `项目的关键目录应包含 CONTEXT.md 文件，描述目录职责和上下文。

[触发条件]
- 在配置的 required_dirs 目录下新增/修改文件
- harness check 运行时自动检查

[要求]
- 每个 required_dirs 中列出的目录必须有 CONTEXT.md
- CONTEXT.md 应包含：职责、核心导出、依赖关系、注意事项

[例外]
- 临时目录（tmp、temp）
- 测试目录（__tests__、test）
- 生成代码目录（dist、build、generated）`,
    exceptions: ['temp_dir', 'test_dir', 'generated_code'],
  },

  /**
   * 文档应与代码同步
   * 例外：WIP 分支、实验性修改
   */
  /**
   * 禁止借口模式
   * 例外：已有明确修复计划
   * 来源：Superpowers 借口防御表
   */
  no_excuse_patterns: {
    id: 'no_excuse_patterns',
    rule: 'NO EXCUSE PATTERNS WITHOUT CONCRETE ACTION PLAN',
    message: '禁止借口模式，必须给出具体行动计划',
    level: 'guideline',
    trigger: ['code_implementation'],
    enforcement: 'excuse-check',
    description: `遇到困难时，禁止使用借口搪塞，必须给出具体的解决计划。

【禁止借口】
- "稍后修复" → 没有具体时间
- "小问题" → 没有影响评估
- "不影响功能" → 没有证据
- "以后再说" → 没有计划
- "先这样" → 没有后续步骤
- "临时方案" → 没有正式方案时间表

【必须】
- 说明问题的具体影响
- 给出修复的时间点或版本
- 如果是临时方案，说明正式方案的计划

【例外】
- 已有明确的修复计划（issue 编号 + 排期）`,
    promptInjection: '遇到困难时，禁止使用借口搪塞（稍后修复、小问题、不影响功能、以后再说、先这样、临时方案）。必须给出：① 问题的具体影响；② 修复的时间点或版本；③ 如果是临时方案，说明正式方案的计划。',
    exceptions: ['has_concrete_plan'],
  },

  /**
   * YAGNI 检查：禁止过度设计
   * 例外：已有明确扩展需求、多平台支持、安全强相关抽象
   * 来源：Superpowers yagni_check
   */
  yagni_check: {
    id: 'yagni_check',
    rule: 'NO SPECULATIVE GENERALIZATION WITHOUT CONCRETE USE CASE',
    message: '禁止过度设计，遵循 YAGNI 原则',
    level: 'guideline',
    trigger: ['code_implementation', 'design_request'],
    enforcement: 'yagni-check',
    description: `遵循 YAGNI 原则（You Aren't Gonna Need It），不要为"未来可能需要"的需求添加代码。

【过度设计信号】
- 只有一个实现者的抽象（interface/abstract class 只有一个 class 实现）
- "以后可能会用到"的参数或配置项
- 为"未来扩展"预留的插件系统
- 超过当前需求的泛型化

【允许】
- 明确在 Spec/Roadmap 中规划的扩展
- 多个平台/环境需要不同实现
- 安全强相关的抽象（如加密算法可替换）

【判断标准】
如果一个抽象只有一个实现者 → 删除这个抽象`,
    promptInjection: '遵循 YAGNI 原则（You Aren\'t Gonna Need It）。不要为"未来可能需要"的需求添加抽象层、接口、配置项或插件系统。如果一个 interface/abstract class 只有一个实现者，删除这个抽象。只实现当前明确需要的功能。',
    exceptions: ['planned_extension', 'multi_platform', 'security_abstraction'],
  },

  /**
   * 禁止无验证完成声明
   * 原因：口头声明"done"与实际情况不符，需要可复现的证据
   */
  no_claim_without_evidence: {
    id: 'no_claim_without_evidence',
    rule: 'NO "DONE" CLAIM WITHOUT VERIFIABLE EVIDENCE',
    message: '禁止无验证的完成声明，必须提供可复现的验证证据',
    level: 'guideline',
    trigger: ['code_implementation', 'file_deletion', 'module_modification'],
    enforcement: 'evidence-check',
    description: `声称任何任务"完成"前，必须提供验证证据：
【代码完成】提供 test 输出（如 "142 passed, 0 failed"）
【文件删除】提供 ls 确认（如 "ls pkg/ → No such file"）
【Spec 完成】提供逐 AC 对照表（每项 pass/fail）
【文档更新】提供 grep 确认（如 "grep '遗留' CLAUDE.md → no match"）`,
    promptInjection: '声称任务"完成"前，必须提供可复现的验证证据：test 输出数字、ls 文件确认、grep 文档确认、spec AC 逐项对照。禁止"我记得""之前说""大部分"等无验证声明。',
  },

  /**
   * 禁止无上下文删除
   * 原因：删除代码前应评估是否有可吸收的功能，避免丢弃有用设计
   */
  no_delete_without_context: {
    id: 'no_delete_without_context',
    rule: 'NO DELETION WITHOUT DESIGN DOCUMENT REVIEW',
    message: '禁止删除代码前未审查设计文档和吸收价值',
    level: 'guideline',
    trigger: ['file_deletion', 'module_deletion'],
    enforcement: 'context-check',
    description: `删除任何代码（包/模块/文件）前，必须：
1. 查设计文档（CLAUDE.md / roadmap / specs）
2. 分析是否有可吸收的功能
3. 记录分析结论（有/无吸收价值，原因）`,
    promptInjection: '删除任何代码包或模块前，必须先查 CLAUDE.md 和相关设计文档，分析是否有可吸收的功能，并记录分析结论。',
  },

  /**
   * 外科手术式修改 — Mnilax Rule 3
   * 原因：只改必要部分，不顺手改相邻代码
   */
  surgical_changes_only: {
    id: 'surgical_changes_only',
    rule: 'ONLY CHANGE WHAT IS ABSOLUTELY NECESSARY',
    message: '只改必要部分，不顺手改相邻代码和格式',
    level: 'guideline',
    trigger: ['code_implementation', 'file_modification'],
    enforcement: 'surgical-check',
    description: `仅改动绝对必要的部分。不"顺手优化"相邻代码、注释或排版格式。未出问题的代码不重构。严格贴合项目既有风格。`,
    promptInjection: '外科手术式修改：仅改动绝对必要的部分。不顺手"优化"相邻代码、注释或格式。未出问题的代码不重构。',
    injectPrompt: true,
  },

  /**
   * 模型只做判断 — Mnilax Rule 5
   * 原因：路由/重试/状态码用代码比 LLM 可靠
   */
  no_model_for_deterministic: {
    id: 'no_model_for_deterministic',
    rule: 'USE MODEL ONLY FOR JUDGMENT CALLS, NOT DETERMINISTIC LOGIC',
    message: '路由/重试/状态码处理→代码，不要调 LLM 决策',
    level: 'guideline',
    trigger: ['code_implementation'],
    enforcement: 'deterministic-check',
    description: `仅将模型用于需要判断与裁量的场景：分类、内容起草、摘要、信息提取。切勿将模型用于：路由分发、重试机制、状态码处理、确定性数据转换。若常规代码能给出答案，就由代码处理。`,
    promptInjection: '模型只做判断不做决策：路由、重试、状态码处理→用代码，不调 LLM。若常规代码能给出答案，就由代码处理。',
    injectPrompt: true,
  },

  /**
   * 暴露冲突 — Mnilax Rule 7
   * 原因：两种模式冲突时不要折中
   */
  no_conflict_blending: {
    id: 'no_conflict_blending',
    rule: 'SURFACE CONFLICTS, DO NOT BLEND THEM',
    message: '两种模式冲突→选其一+说明理由，不折中',
    level: 'guideline',
    trigger: ['code_implementation', 'module_extension'],
    enforcement: 'conflict-check',
    description: `若代码库中既有的两种模式相互矛盾，明确选择其一（优先更新或更经测试的版本），阐明选择理由，将另一种标记为待清理项。试图同时迎合两套规则的中庸代码往往是最糟的。`,
    promptInjection: '暴露冲突不折中：若两种模式冲突→选其一（优先更经测试的版本）+说明理由+标记另一种为待清理。',
    injectPrompt: true,
  },

  /**
   * 先读后写 — Mnilax Rule 8
   * 原因：加代码前必须理解上下文
   */
  read_before_write: {
    id: 'read_before_write',
    rule: 'READ IMPORTS AND CALLERS BEFORE ADDING CODE',
    message: '加代码前先读文件的导入、调用方、工具函数',
    level: 'guideline',
    trigger: ['code_implementation', 'file_modification'],
    enforcement: 'read-check',
    description: `在文件中添加代码前，必须通读该文件的导出接口、直接调用方以及任何显而易见的公共工具函数。"看似互不干涉"是最危险的判断。若不理解现有代码为何采用当前结构，在动手添加前必须先提问确认。`,
    promptInjection: '先读后写：加代码前读 imports/callers/工具函数。"看似互不干涉"是最危险的判断。不理解现有结构时先提问。',
    injectPrompt: true,
  },

  /**
   * 约定胜于新奇 — Mnilax Rule 11
   * 原因：规范一致性 > 技术偏好
   */
  follow_conventions: {
    id: 'follow_conventions',
    rule: 'MATCH CODEBASE CONVENTIONS, EVEN IF YOU DISAGREE',
    message: '规范一致性 > 技术偏好，有异议显式提出不暗中背离',
    level: 'guideline',
    trigger: ['code_implementation', 'module_extension'],
    enforcement: 'convention-check',
    description: `在代码库内部：规范一致性 > 个人技术偏好。若项目用 snake_case 而你偏好 camelCase：用 snake_case。若项目用 class 组件而你偏好 hooks：用 class。若确信某规范存在实质危害，请显式提出。切勿暗中背离规范另起范式。`,
    promptInjection: '约定胜于新奇：规范一致性 > 技术偏好。项目用 snake_case 就用 snake_case。有异议显式提出，不暗中另起范式。',
    injectPrompt: true,
  },

  /**
   * 第一性优先 — Mnilax extension
   * 原因：从当前状态推导结论会自我证明。正确顺序：第一性→事实校验→结论。
   */
  first_principles_first: {
    id: 'first_principles_first',
    rule: 'ANALYZE FROM FIRST PRINCIPLES, NOT FROM CURRENT STATE',
    message: '分析顺序: 第一性→事实校验→结论。禁止"代码就是这样"作为理由',
    level: 'guideline',
    trigger: ['code_implementation', 'module_modification', 'file_modification'],
    enforcement: 'principle-check',
    description: `架构分析与设计决策必须从第一性原理出发，而非从当前实现状态推导。禁止的模式: "当前代码这样写的所以应该保持这样"——这是自我证明的错误逻辑。`,
    promptInjection: '第一性优先: 分析设计问题从本质出发，不从当前代码推导。正确设计是什么→当前实现匹配吗→差距决定行动。禁止"代码就是这样"作为理由。',
    injectPrompt: true,
  },

  /**
  /**
   * 原因：质量门阻断是信号，不是障碍。调整门禁而非修复违规是自我欺骗。
   */
  fix_the_problem_not_the_gate: {
    id: 'fix_the_problem_not_the_gate',
    rule: 'FIX THE PROBLEM THAT TRIGGERED THE GATE, NOT THE GATE ITSELF',
    message: '修复触发门禁的问题，不降低门禁本身',
    level: 'guideline',
    trigger: ['code_implementation', 'module_modification', 'file_modification'],
    enforcement: 'principle-check',
    description: `质量门禁（测试失败、lint 报错、覆盖率不足、约束违规）阻断时，修复导致阻断的代码，而非调整门禁门槛。降低阈值、删除测试、关闭 lint 规则是对质量信号的压制，不是质量改进。`,
    promptInjection: '质量门禁阻断时修复代码，不修复门禁。不降阈值、不删测试、不关 lint、不改断言让 CI 通过。',
    injectPrompt: true,
  },

  /**
   * 下游修复前先诊断上游
   * 原因：兼容/兜底是掩盖，不是修复。连续 fallback 同一位置 2+ 次是上游 bug 信号。
   */
  no_fallback_without_root_cause: {
    id: 'no_fallback_without_root_cause',
    rule: 'BEFORE ADDING FALLBACK, TRACE UPSTREAM FIRST',
    message: '禁止用兼容/兜底掩盖上游数据异常。先追根因——谁产生的？为什么是空？',
    level: 'guideline',
    trigger: ['code_implementation', 'module_modification', 'file_modification'],
    enforcement: 'principle-check',
    description: `遇到空值/异常/不完整数据时，禁止直接用 fallback/default/兜底值掩盖。必须先追踪数据来源——哪个上游产生的？为什么异常？修复上游 OR 添加防御性兜底——选择后者时必须在代码注释中说明根因。重复 fallback 同一问题 2+ 次是 sign of upstream bug。`,
    promptInjection: '改动前先问: 数据从哪来？为什么是空的？fix upstream first, fallback second。连续 2+ 次相同错误 → 停止修下游,追踪源头。',
    injectPrompt: true,
  },
};

// ========================================
// TIPS（提示）
//
// 定义：信息性提示，可忽略
// ========================================

export const TIPS: Record<string, Constraint> = {
  /**
   * 建议写 README
   */
  readme_required: {
    id: 'readme_required',
    rule: 'NEW MODULES SHOULD HAVE README',
    message: '建议为新模块创建 README',
    level: 'tip',
    trigger: 'module_creation',
    enforcement: 'create-readme',
    description: `创建新模块时建议同时创建 README.md，说明：

- 模块用途
- 使用方法
- API 文档
- 示例代码

README 帮助其他开发者快速了解模块。`,
  },

  /**
   * 建议写 API 文档
   */
  doc_required_for_public_api: {
    id: 'doc_required_for_public_api',
    rule: 'PUBLIC API SHOULD HAVE DOCUMENTATION',
    message: '建议为公共 API 添加文档注释',
    level: 'tip',
    trigger: 'export_change',
    enforcement: 'add-docs',
    description: `所有导出的函数、类、接口建议添加 JSDoc 注释：

\`\`\`typescript
/**
 * 计算两个数的和
 * @param a 第一个数
 * @param b 第二个数
 * @returns 两数之和
 */
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

文档注释帮助 IDE 提供智能提示。`,
  },
};

// ========================================
// 辅助函数
// ========================================

/**
 * 获取所有约束（三层合并）
 */
export function getAllConstraints(): Constraint[] {
  return [
    ...Object.values(IRON_LAWS),
    ...Object.values(GUIDELINES),
    ...Object.values(TIPS),
  ];
}

/**
 * 根据触发条件查找适用的约束
 */
export function findConstraintsByTrigger(trigger: ConstraintTrigger): Constraint[] {
  return getAllConstraints().filter(constraint => {
    const triggers = Array.isArray(constraint.trigger) ? constraint.trigger : [constraint.trigger];
    return triggers.includes(trigger);
  });
}

/**
 * 根据 ID 获取约束
 */
export function getConstraint(id: string): Constraint | undefined {
  return IRON_LAWS[id] || GUIDELINES[id] || TIPS[id];
}

// ========================================
// 向后兼容的函数
// ========================================

/**
 * @deprecated 使用 getAllConstraints 代替
 */
export function getAllLaws(): Constraint[] {
  return getAllConstraints();
}

/**
 * @deprecated 使用 findConstraintsByTrigger 代替
 */
export function findLawsByTrigger(trigger: ConstraintTrigger): Constraint[] {
  return findConstraintsByTrigger(trigger);
}

/**
 * @deprecated 使用 getConstraint 代替
 */
export function getLaw(id: string): Constraint | undefined {
  return getConstraint(id);
}

/**
 * @deprecated 使用 GUIDELINES 代替
 */
export const filterLawsBySeverity = (severity: 'error' | 'warning' | 'info'): Constraint[] => {
  // 向后兼容映射
  if (severity === 'error') return Object.values(IRON_LAWS);
  if (severity === 'warning') return Object.values(GUIDELINES);
  if (severity === 'info') return Object.values(TIPS);
  return [];
};