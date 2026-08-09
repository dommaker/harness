/**
 * prompt 类约束定义（ADR-0001：kind 二元模型）
 *
 * 纯文本提示层：
 * - kind: 'prompt'，level 统一为 'prompt'
 * - 不带 checker，不参与运行时检查与 trace 统计
 * - promptInjection 参与 init 注入；trigger 供消费端（studio）做角色路由
 * - appliesTo 标注适用场景（如 'agent-skill'、'llm-app'），缺省为通用
 */

import type { Constraint } from '../../../types/constraint';

export const PROMPTS: Record<string, Constraint> = {
  /**
   * 禁止模糊完成声明（合并枢纽）
   * 吸收：no_self_approval、no_claim_without_evidence、no_excuse_patterns
   */
  no_fuzzy_completion_claim: {
    id: 'no_fuzzy_completion_claim',
    kind: 'prompt',
    rule: 'NO FUZZY COMPLETION CLAIMS WITHOUT QUANTIFIABLE EVIDENCE',
    message: '禁止模糊完成声明，必须提供可量化证据',
    level: 'prompt',
    trigger: ['code_implementation', 'design_request', 'task_completion_claim', 'file_deletion', 'module_modification'],
    enforcement: 'fuzzy-check',
    description: `声明任务完成时，禁止使用模糊词语，必须提供具体、可量化、可复现的验证结果；不得仅凭自己的判断声称完成（吸收 no_self_approval / no_claim_without_evidence）。

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
- Spec AC 对照表（逐项标注 pass/fail）

【禁止借口】（吸收 no_excuse_patterns）
- "稍后修复"、"小问题"、"不影响功能"、"以后再说"、"先这样"、"临时方案"
- 必须说明问题的具体影响、修复的时间点或版本；临时方案须给出正式方案计划`,
    promptInjection: '声明任务完成时，必须附可复现的验证证据，不得仅凭自己的判断声称完成：测试给出精确通过数量与验证命令输出（如 "142 passed, 0 failed"），声明"已删除"前用 ls 确认文件不存在，文档结论用 grep 确认，Spec 完成前逐条 AC 对照标注 pass/fail。禁用模糊词："应该没问题""大概完成了""基本完成""差不多""我记得""之前说""已修复"（未经 test 验证）。遇困难禁止借口搪塞（"稍后修复""小问题""不影响功能""以后再说""先这样""临时方案"）——必须说明问题的具体影响、修复的时间点或版本；是临时方案的，给出正式方案的计划。',
  },

  /**
   * 禁止无根因修复（合并枢纽）
   * 吸收：no_fallback_without_root_cause、analysis_verification_gate、diagnosis_to_fix_gate
   */
  no_fix_without_root_cause: {
    id: 'no_fix_without_root_cause',
    kind: 'prompt',
    rule: 'NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST',
    message: '复杂 bug 必须先调查根本原因',
    level: 'prompt',
    trigger: ['code_implementation', 'module_modification', 'file_modification', 'design_request', 'diagnosis'],
    enforcement: 'debug-systematic',
    description: `在尝试修复 bug 之前，必须先诊断根因（吸收 no_fallback_without_root_cause / analysis_verification_gate / diagnosis_to_fix_gate）。

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
- 看到 error 就直接 try-catch 掩盖
- 用 fallback/兜底值掩盖上游数据异常而不追根因
- Read 定位后直接 Edit，不对照设计原型确认意图
- 从"数字异常"直接跳到根因结论，不验证假设的含义与量纲`,
    exceptions: ['simple_typo', 'config_value_error', 'missing_config'],
    promptInjection: '修复问题前必须先诊断根因——不止"哪里出错"，而是"为什么设计成这样"：用 Read/Grep 定位后禁止直接 Edit，先对照设计原型（CLAUDE.md、类型定义、commit message）确认原设计意图，呈现确认的根因+方案草案后才能动手。遇到空值/异常/不完整数据，禁止用 fallback/兜底/try-catch 掩盖——先追上游：数据谁产生的？为什么是空的？选择防御性兜底时必须在注释中说明根因；同一位置连续兜底 2+ 次是上游 bug 信号，停止修下游、追踪源头。从数据到结论必须先验证关键假设：数字的含义（累积/单次？量纲？）、正常范围、同类场景对比与反例，禁止"数字异常→直接定根因→直接改"的跳级推理。不绕过问题、不遮掩症状、不用临时方案代替根本修复。',
  },

  /**
   * 简单方案优先（合并枢纽）
   * 吸收：no_creation_without_reuse_check、yagni_check
   */
  simplest_solution_first: {
    id: 'simplest_solution_first',
    kind: 'prompt',
    rule: 'CHECK LOCAL/SIMPLE OPTIONS BEFORE REMOTE/COMPLEX',
    message: '先检查本地/简单方案',
    level: 'prompt',
    trigger: ['code_implementation', 'module_extension', 'module_creation', 'design_request'],
    enforcement: 'check-local-first',
    description: `在实现功能时，必须按顺序检查（吸收 no_creation_without_reuse_check / yagni_check）：
1) 是否有本地数据源（内存/文件）？
2) 是否有更简单的方案（更少依赖/更少代码）？
3) 创建新能力前是否查过现有能力索引，确认无可复用？
4) 如需远程查询/复杂架构，必须说明理由。

复用优先级：直接复用 > 扩展现有 > 组合现有 > 创建新能力。

例外情况（可跳过简单方案）：
- scalability_required: 需要多实例/分布式部署
- security_required: 需要加密/鉴权等安全措施
- performance_required: 本地方案性能不足
- reliability_required: 需要持久化/高可用

YAGNI：不为"未来可能需要"添加抽象层、接口、配置项或插件系统；一个抽象只有一个实现者时删除该抽象。`,
    exceptions: ['scalability_required', 'security_required', 'performance_required', 'reliability_required'],
    promptInjection: '最简方案优先：用最少代码解决当前问题，不添加"以防万一"的冗余功能，不为仅用一次的代码强行设计抽象。创建新模块/文件/能力前，先查现有能力索引确认无可复用——优先级：直接复用 > 扩展现有 > 组合现有 > 新建。遵循 YAGNI：不为"未来可能需要"添加抽象层、接口、配置项或插件系统；一个 interface/abstract class 只有一个实现者时，删除这个抽象。自检：资深工程师是否会认为此实现过度复杂？若是，立即简化。',
    injectPrompt: true,
  },

  /**
   * 业务逻辑代码必须先写测试
   * 例外：配置文件、类型定义
   */
  no_code_without_test: {
    id: 'no_code_without_test',
    kind: 'prompt',
    rule: 'PRODUCTION LOGIC CODE MUST HAVE TESTS FIRST',
    message: '业务逻辑代码必须先写测试',
    level: 'prompt',
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
    promptInjection: '新代码必须同时编写测试。实现功能前先写测试用例（RED），然后实现让测试通过（GREEN）。不得提交无测试覆盖的实现代码。',
  },

  /**
   * 禁止砍功能
   * 例外：冗余代码清理
   */
  no_simplification_without_approval: {
    id: 'no_simplification_without_approval',
    kind: 'prompt',
    rule: 'NO SIMPLIFYING LOGIC WITHOUT USER APPROVAL',
    message: '禁止砍功能，合理重构除外',
    level: 'prompt',
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
    promptInjection: '不得擅自简化或删除测试、lint 规则、类型检查或约束。如需降低检查标准，必须先提案并获明确批准。',
  },

  /**
   * 修复触发门禁的问题，而非门禁本身
   * 原因：质量门阻断是信号，不是障碍。调整门禁而非修复违规是自我欺骗。
   */
  fix_the_problem_not_the_gate: {
    id: 'fix_the_problem_not_the_gate',
    kind: 'prompt',
    rule: 'FIX THE PROBLEM THAT TRIGGERED THE GATE, NOT THE GATE ITSELF',
    message: '修复触发门禁的问题，不降低门禁本身',
    level: 'prompt',
    trigger: ['code_implementation', 'module_modification', 'file_modification'],
    enforcement: 'principle-check',
    description: `质量门禁（测试失败、lint 报错、覆盖率不足、约束违规）阻断时，修复导致阻断的代码，而非调整门禁门槛。降低阈值、删除测试、关闭 lint 规则是对质量信号的压制，不是质量改进。`,
    promptInjection: '质量门禁阻断时修复代码，不修复门禁。不降阈值、不删测试、不关 lint、不改断言让 CI 通过。',
    injectPrompt: true,
  },

  /**
   * 禁止实现未验证的外部依赖能力
   * 原因：假设外部系统能力存在，实现后发现不支持，浪费开发时间
   */
  verify_external_capability: {
    id: 'verify_external_capability',
    kind: 'prompt',
    rule: 'VERIFY EXTERNAL CAPABILITY BEFORE IMPLEMENTATION',
    message: '外部依赖能力必须先验证',
    level: 'prompt',
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

【正确流程】
设计方案 → 查阅文档限制 → 发送最小测试 → 验证可行 → 开发`,
    promptInjection: '实现方案依赖外部 API/服务未确认的能力时，必须先查阅官方文档确认能力存在，再发送最小测试验证可行性，记录限制作为设计约束。不要假设外部系统支持某种能力就直接开发。',
  },

  /**
   * 禁止无上下文删除
   * 原因：删除代码前应评估是否有可吸收的功能，避免丢弃有用设计
   */
  no_delete_without_context: {
    id: 'no_delete_without_context',
    kind: 'prompt',
    rule: 'NO DELETION WITHOUT DESIGN DOCUMENT REVIEW',
    message: '禁止删除代码前未审查设计文档和吸收价值',
    level: 'prompt',
    trigger: ['file_deletion', 'module_deletion'],
    enforcement: 'context-check',
    description: `删除任何代码（包/模块/文件）前，必须：
1. 查设计文档（CLAUDE.md / roadmap / specs）
2. 分析是否有可吸收的功能
3. 查替代函数是否丢失了关键设计模式（零引用≠无价值）
4. 分类：未接线（应接线）/ 被替代但有可吸收设计 / 真正无用
5. 记录分析结论（有/无吸收价值，原因）`,
    promptInjection: '删除任何代码前，先查设计意图（JSDoc/commit/spec），分析被替代的函数是否有丢失的关键模式。零引用≠无价值。分类：未接线→接线，被替代→吸收模式，真正无用→才删。',
  },

  /**
   * 设计决策需先讨论
   * 例外：明确指令、紧急修复、已有设计文档
   */
  design_decision_requires_discussion: {
    id: 'design_decision_requires_discussion',
    kind: 'prompt',
    rule: 'DESIGN DECISIONS MUST BE DISCUSSED BEFORE IMPLEMENTATION',
    message: '设计决策类任务需先讨论方案再实现',
    level: 'prompt',
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
    promptInjection: '涉及架构变更、新增依赖、API 设计等重大决策时，必须先提出讨论获得确认，再开始实现。不要凭单方面判断做架构决策。',
  },

  /**
   * 外科手术式修改 — Mnilax Rule 3
   * 原因：只改必要部分，不顺手改相邻代码
   */
  surgical_changes_only: {
    id: 'surgical_changes_only',
    kind: 'prompt',
    rule: 'ONLY CHANGE WHAT IS ABSOLUTELY NECESSARY',
    message: '只改必要部分，不顺手改相邻代码和格式',
    level: 'prompt',
    trigger: ['code_implementation', 'file_modification'],
    enforcement: 'surgical-check',
    description: `仅改动绝对必要的部分。不"顺手优化"相邻代码、注释或排版格式。未出问题的代码不重构。严格贴合项目既有风格。`,
    promptInjection: '外科手术式修改：仅改动绝对必要的部分。不顺手"优化"相邻代码、注释或格式。未出问题的代码不重构。',
    injectPrompt: true,
  },

  /**
   * 约定胜于新奇 — Mnilax Rule 11
   * 原因：规范一致性 > 技术偏好
   */
  follow_conventions: {
    id: 'follow_conventions',
    kind: 'prompt',
    rule: 'MATCH CODEBASE CONVENTIONS, EVEN IF YOU DISAGREE',
    message: '规范一致性 > 技术偏好，有异议显式提出不暗中背离',
    level: 'prompt',
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
    kind: 'prompt',
    rule: 'ANALYZE FROM FIRST PRINCIPLES, NOT FROM CURRENT STATE',
    message: '分析顺序: 第一性→事实校验→结论。禁止"代码就是这样"作为理由',
    level: 'prompt',
    trigger: ['code_implementation', 'module_modification', 'file_modification'],
    enforcement: 'principle-check',
    description: `架构分析与设计决策必须从第一性原理出发，而非从当前实现状态推导。禁止的模式: "当前代码这样写的所以应该保持这样"——这是自我证明的错误逻辑。`,
    promptInjection: '第一性优先: 分析设计问题从本质出发，不从当前代码推导。正确设计是什么→当前实现匹配吗→差距决定行动。禁止"代码就是这样"作为理由。',
    injectPrompt: true,
  },

  /**
   * 暴露冲突 — Mnilax Rule 7
   * 原因：两种模式冲突时不要折中
   */
  no_conflict_blending: {
    id: 'no_conflict_blending',
    kind: 'prompt',
    rule: 'SURFACE CONFLICTS, DO NOT BLEND THEM',
    message: '两种模式冲突→选其一+说明理由，不折中',
    level: 'prompt',
    trigger: ['code_implementation', 'module_extension'],
    enforcement: 'conflict-check',
    description: `若代码库中既有的两种模式相互矛盾，明确选择其一（优先更新或更经测试的版本），阐明选择理由，将另一种标记为待清理项。试图同时迎合两套规则的中庸代码往往是最糟的。`,
    promptInjection: '暴露冲突不折中：若两种模式冲突→选其一（优先更经测试的版本）+说明理由+标记另一种为待清理。',
    injectPrompt: true,
  },

  /**
   * 禁止表演性同意
   * 原因：同意不等于理解，必须先分析再确认
   * 来源：Superpowers no_performative_agreement
   */
  no_performative_agreement: {
    id: 'no_performative_agreement',
    kind: 'prompt',
    rule: 'NO PERFORMATIVE AGREEMENT WITHOUT ANALYSIS',
    message: '禁止表演性同意，必须先分析再确认',
    level: 'prompt',
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
   * 技能需要测试
   * 例外：MVP
   */
  no_skill_without_test: {
    id: 'no_skill_without_test',
    kind: 'prompt',
    rule: 'NO SKILL WITHOUT A FAILING TEST FIRST',
    message: '创建技能前必须先定义测试场景',
    level: 'prompt',
    trigger: 'module_creation',
    enforcement: 'skill-test-scenario',
    appliesTo: ['agent-skill'],
    description: `在创建新的 agent 技能之前，必须先定义测试场景：

1. 定义输入/输出期望
2. 定义边界条件
3. 定义失败场景
4. 编写测试用例

测试场景帮助：
- 明确技能的功能边界
- 验证技能的正确性
- 防止回归`,
    promptInjection: '新创建的 Skill 模块必须有对应的测试文件。测试应覆盖正常路径、边界情况和错误处理。',
  },

  /**
   * 模型只做判断 — Mnilax Rule 5
   * 原因：路由/重试/状态码用代码比 LLM 可靠
   */
  no_model_for_deterministic: {
    id: 'no_model_for_deterministic',
    kind: 'prompt',
    rule: 'USE MODEL ONLY FOR JUDGMENT CALLS, NOT DETERMINISTIC LOGIC',
    message: '路由/重试/状态码处理→代码，不要调 LLM 决策',
    level: 'prompt',
    trigger: ['code_implementation'],
    enforcement: 'deterministic-check',
    appliesTo: ['llm-app'],
    description: `仅将模型用于需要判断与裁量的场景：分类、内容起草、摘要、信息提取。切勿将模型用于：路由分发、重试机制、状态码处理、确定性数据转换。若常规代码能给出答案，就由代码处理。`,
    promptInjection: '模型只做判断不做决策：路由、重试、状态码处理→用代码，不调 LLM。若常规代码能给出答案，就由代码处理。',
    injectPrompt: true,
  },
};
