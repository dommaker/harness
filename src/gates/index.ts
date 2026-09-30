/**
 * 门禁系统子路径入口（./gates）
 *
 * 公共面已随 #199（ADR-0038「CLI 可达 ≠ 导出理由」）整体收回：本层符号只被
 * 本仓 CLI 经实现文件直引消费，双仓无编程消费者。入口本身保留（package.json
 * exports 不动），是否摘除由 maintainer 裁决。
 * 决策契约（deny 单调 / ask fail-closed / 决策浅冻结）正本见本目录 CONTEXT.md。
 */

// 空面入口：保持模块身份（值面/类型面冻结闸与 tsc 以模块口径加载本文件）
export {};
