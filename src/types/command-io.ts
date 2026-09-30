/**
 * 命令输出流注入面（Phase 4 类型收口）
 *
 * 正本原居 `cli/command-contract.ts`；core（constraint-lifecycle 的历史签名槽）
 * 也消费它，形成 core→cli 的类型倒挂。按分层 `types → … → cli`，这个被两层
 * 消费的公共类型下沉到 types 层；cli/command-contract.ts re-export 本定义，
 * 既有 CLI 消费方导入路径不变。
 *
 * 最小可写接口：`process.stdout` / `process.stderr` 结构化满足。
 */
export interface CommandIO {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
}
