/**
 * 通用工具模块
 *
 * 提供命令执行的公共函数，减少各子系统重复代码。
 * 两个出口分工：`execAsync` = shell 字符串（仅消费方自己控制完整命令串时用）；
 * `execFileAsync` = argv 数组（外部路径/参数不经 shell 插值，P0.3 起的外部输入一律走这里）。
 * 约束域谓词不在本模块（harness#137：`normalizeTriggers`/`matchesTrigger` 已迁
 * `core/constraints/triggers.ts`；`isCommandAvailable`/`delay` 双仓零生产消费者，已删；
 * `runCommand` 零生产调用点且不在包公共面，按 ADR-0022 同判据随 harness#162 删除）。
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';

/**
 * Promisified exec
 */
export const execAsync = promisify(exec);

/**
 * Promisified execFile（argv 形状，不经 shell）
 */
export const execFileAsync = promisify(execFile);
