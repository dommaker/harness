/**
 * 填空式 checker 模板（ADR-0033 两层约束模型，块 3 子项 2）
 *
 * 每个模板 = TemplatedCheckerFactory（validateParams + create），注册进
 * checkers/index.ts 的 TEMPLATES 供应用层约束（`.harness/constraints.yml`）
 * 按 checker + params 实例化。
 *
 * 模板只认参数不认应用语义（harness 零业务逻辑）：约束条文、文案归应用仓。
 */

export { regexScan } from './regex-scan';
export { fileExists } from './file-exists';
export { execScript } from './exec';
