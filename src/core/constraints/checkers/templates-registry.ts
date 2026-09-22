/**
 * 填空式 checker 模板注册表（ADR-0033 两层约束模型）
 *
 * 独立成模块而非住在 checkers/index.ts：应用层加载器（core/app-constraints-loader）
 * 要做加载期模板校验，若直接引 checkers/index.ts 会经 project-config-loader →
 * 本注册表 → 内置 checker → project-config-loader 形成值级循环（checker 初始化时
 * 拿到 undefined）。本模块不引内置 checker，无环。
 *
 * 闭环语义：模板 id 未注册即不可用——加载期由 app-constraints-loader 校验，
 * 运行期由 checkers/index.ts 的 getConstraintCheck 抛错兜底。
 *
 * 本票（块 3 子项 1）为空表：首批模板（regex-scan / file-exists）随子项 2 注册。
 */

import type { TemplatedCheckerFactory } from './types';

/** 模板注册表（模板 id → 工厂）；测试可注册替身模板，用后须注销 */
export const TEMPLATES = new Map<string, TemplatedCheckerFactory>();
