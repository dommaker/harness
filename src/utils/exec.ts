/**
 * 通用工具模块
 *
 * 提供命令执行的公共函数，减少各子系统重复代码。
 * 约束域谓词不在本模块（harness#137：`normalizeTriggers`/`matchesTrigger` 已迁
 * `core/constraints/triggers.ts`；`isCommandAvailable`/`delay` 双仓零生产消费者，已删；
 * `runCommand` 零生产调用点且不在包公共面，按 ADR-0022 同判据随 harness#162 删除）。
 */

import { exec } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified exec
 */
export const execAsync = promisify(exec);
