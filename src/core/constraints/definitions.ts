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
    trigger: 'step_execution',
    enforcement: 'checkpoint-required',
    description: '所有检查点必须通过，不能跳过验证步骤。检查点是质量的最后一道防线。',
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
    trigger: 'task_completion_claim',
    enforcement: 'verify-completion',
    description: '在声明任何任务完成之前，必须运行新鲜的、完整的验证命令。验证命令包括：npm test、npm run build、CI 流程。',
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
    trigger: 'feature_completion_claim',
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
  },

  /**
   * 禁止实现未验证的外部依赖能力
   * 来源：DD-009 Discord 按钮方案教训（2026-04-22）
   * 原因：假设外部系统能力存在，实现后发现不支持，浪费开发时间
   */
  verify_external_capability: {
    id: 'verify_external_capability',
    rule: 'VERIFY EXTERNAL CAPABILITY BEFORE IMPLEMENTATION',
    message: '外部依赖能力必须先验证',
    level: 'iron_law',
    trigger: 'external_api_design',
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

【案例】DD-009 Discord 按钮方案（2026-04-22）
- 假设 Webhook 支持按钮交互
- 未查阅 Discord API 文档限制
- 实现 NotifyService 支持 components
- 发送测试消息才发现 Webhook 不支持交互回调
- 浪费 30 分钟开发时间，改用 /meeting 指令方案

【正确流程】
设计方案 → 查阅文档限制 → 发送最小测试 → 验证可行 → 开发`,
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
    trigger: 'implementation_complete',
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

【案例】AS-011 Meeting→Project 自动关联（2026-04-27）
- 需求：会议结束自动创建 Project（如果无关联）
- 实现：增加了 effectiveProjectId 逻辑
- 验证：✅ 检查了 Spec 定义、测试了多种场景`,
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
    trigger: 'bug_fix_attempt',
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
    trigger: ['feature_development', 'module_extension', 'code_implementation'],
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
      'step_creation',
      'tool_creation',
      'workflow_creation',
      'module_creation',
      'module_extension',
      'feature_development',
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
    trigger: 'skill_creation',
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
    trigger: 'task_completion_claim',
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
    trigger: ['design_request', 'architecture_change', 'feature_development'],
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