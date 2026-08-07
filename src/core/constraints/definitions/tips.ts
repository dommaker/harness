/**
 * 约束定义拆分文件（工单 20）：原 definitions.ts 按层拆分，
 * definitions.ts 保持原路径做薄聚合（studio rule-scanner 契约）。
 */

import type { Constraint } from '../../../types/constraint';

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
    promptInjection: '创建新模块时，同时创建 README.md 说明模块用途、使用方法和 API 文档，帮助其他开发者快速了解模块。',
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
    promptInjection: '公共 API（导出的函数、类、接口）必须有 JSDoc 文档注释，说明参数、返回值和用法示例。',
  },
};
