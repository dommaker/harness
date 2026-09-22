/**
 * check 约束定义（severity='error' 组，ADR-0029）
 *
 * 只保留带真实 checker 的约束。每条必须：
 * - kind: 'check'
 * - severity: 'error'（违规即阻断）
 * - 在 checkers/ 注册表中有对应实现（注册表闭环，缺失即加载期抛错）
 */

import type { Constraint } from '../../../types/constraint';

export const ERROR_CONSTRAINTS: Record<string, Constraint> = {
  /**
   * 禁止无验证声明完成
   * 原因：质量底线，必须有验证命令
   */
  no_completion_without_verification: {
    id: 'no_completion_without_verification',
    kind: 'check',
    rule: 'NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE',
    message: '禁止无验证声明完成，必须运行验证命令',
    severity: 'error',
    trigger: 'code_implementation',
    enforcement: 'verify-completion',
    description: '在声明任何任务完成之前，必须运行新鲜的验证命令（项目声明的测试 + type check），以新鲜输出作为完成证据。验证命令集由项目自行声明，全量验证留给 CI 流程。',
  },

  /**
   * 禁止硬编码凭证
   * 原因：密码/token/密钥泄露是最严重的安全漏洞，一旦提交到版本控制即不可逆。
   * ADR-0032：安全底线类约束，warning 不阻断等于没有——升级为 error（违规即阻断）。
   */
  no_hardcoded_credentials: {
    id: 'no_hardcoded_credentials',
    kind: 'check',
    rule: 'NO HARDCODED PASSWORDS, TOKENS, SECRETS, OR CREDENTIALS IN ANY SOURCE FILE',
    message: '禁止在代码/文档/配置文件中硬编码密码、token、密钥、API key',
    severity: 'error',
    trigger: ['code_implementation', 'doc_update', 'config_change', 'commit'],
    enforcement: 'credential-scan',
    description: `凭证（密码/token/密钥/API key）必须从环境变量或加密配置读取，严禁以明文形式出现在任何源代码文件中。包括但不限于：源码、Markdown 文档、YAML/JSON 配置、脚本文件。模板文件（.example/.sample/.template）允许占位符但不得包含真实值。建议配合 pre-commit hook 做自动扫描。`,
  },

  /**
   * 禁止简化测试
   * 原因：质量底线，测试困难必须解决
   * （harness#174：checker 承载执行）
   */
  no_test_simplification: {
    id: 'no_test_simplification',
    kind: 'check',
    rule: 'NO SIMPLIFYING TESTS TO AVOID DIFFICULTY',
    message: '禁止简化测试绕过困难',
    severity: 'error',
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
   * 文档新鲜度
   * 原因：只警告不阻断会导致文档持续腐烂。
   */
  docs_freshness: {
    id: 'docs_freshness',
    kind: 'check',
    rule: 'CAPABILITIES.MD MUST BE IN SYNC WITH CODE',
    message: 'CAPABILITIES.md 与源码不同步，运行 harness sync-docs 更新后重新提交',
    severity: 'error',
    trigger: ['file_modification', 'module_creation', 'module_modification'],
    enforcement: 'docs-sync-check',
    description: `CAPABILITIES.md 中列出的文件必须在 src/ 中实际存在。删除源文件时须从 CAPABILITIES.md 同步移除。运行 harness sync-docs 自动修复过期引用。
注: CONTEXT.md 已删除。目录描述集中在 CLAUDE.md Key Subsystems 表中。新增文件全覆盖检查待 sync-docs 完善后启用。`,
  },
};
