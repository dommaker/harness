/**
 * check · guideline 定义（ADR-0001：kind 二元模型）
 *
 * 只保留带真实 checker 的指导原则。每条必须：
 * - kind: 'check'
 * - level: 'guideline'
 * - 在 checkers/ 注册表中有对应实现（注册表闭环，缺失即加载期抛错）
 */

import type { Constraint } from '../../../types/constraint';

export const GUIDELINES: Record<string, Constraint> = {
  /**
   * 禁止硬编码凭证
   * 原因：密码/token/密钥泄露是最严重的安全漏洞，一旦提交到版本控制即不可逆
   */
  no_hardcoded_credentials: {
    id: 'no_hardcoded_credentials',
    kind: 'check',
    rule: 'NO HARDCODED PASSWORDS, TOKENS, SECRETS, OR CREDENTIALS IN ANY SOURCE FILE',
    message: '禁止在代码/文档/配置文件中硬编码密码、token、密钥、API key',
    level: 'guideline',
    trigger: ['code_implementation', 'doc_update', 'config_change', 'commit'],
    enforcement: 'credential-scan',
    description: `凭证（密码/token/密钥/API key）必须从环境变量或加密配置读取，严禁以明文形式出现在任何源代码文件中。包括但不限于：源码、Markdown 文档、YAML/JSON 配置、脚本文件。模板文件（.example/.sample/.template）允许占位符但不得包含真实值。建议配合 pre-commit hook 做自动扫描。`,
    promptInjection: '禁止在代码中硬编码密码、API 密钥、Token 等凭证。使用环境变量或安全的凭证管理方案存储敏感信息。',
  },

  /**
   * 禁止跳过检查点验证
   * 原因：安全底线，检查点是质量门控
   */
  no_bypass_checkpoint: {
    id: 'no_bypass_checkpoint',
    kind: 'check',
    rule: 'NO BYPASSING CHECKPOINTS',
    message: '禁止跳过检查点验证',
    level: 'guideline',
    trigger: 'code_implementation',
    enforcement: 'checkpoint-required',
    description: '所有检查点必须通过，不能跳过验证步骤。检查点是质量的最后一道防线。',
    promptInjection: '每个关键步骤后有 checkpoint 验证点，必须通过才能继续。通过标准：测试通过、类型检查无错误、lint 无新增警告。未通过时回退修复，不得跳过。',
  },

  /**
   * 功能清单同步
   * 例外：内部重构、bug fix
   */
  capability_sync: {
    id: 'capability_sync',
    kind: 'check',
    rule: 'CODE CHANGES MUST UPDATE CAPABILITIES.MD',
    message: '核心模块变更必须同步功能清单（支持模块级目录条目登记）',
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
- 性能优化不改变接口

支持模块级目录条目登记：governance.capabilities.mode=module 时按目录覆盖判定（如 src/core/ 一条目录条目覆盖该目录下所有源文件）。`,
  },

  /**
   * 关键目录需要 CONTEXT.md
   * 例外：临时目录、测试目录、生成代码目录
   */
  context_doc_sync: {
    id: 'context_doc_sync',
    kind: 'check',
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
  },
};
