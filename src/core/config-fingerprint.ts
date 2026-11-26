/**
 * 配置指纹与观察期恢复（下游配置公共化）
 *
 * 消费方进化链路的「写前指纹 → 观察期备份 → 条件恢复」收进 harness 公共接口，
 * 目标路径（`.harness/config.yml`）由 harness 内部解析，消费方不再拼布局：
 *
 * - `fingerprintConfig`：目标在场返回 SHA-256，缺失返回 null（只读）；
 * - `backupConfigFile`：观察期磁盘备份（消费方显式请求才建，见
 *   constraint-lifecycle 的 `createBackup` 选项）；
 * - `restoreConfig`：恢复契约 = before/after SHA-256 + backupPath：
 *   - 当前 hash = after → 恢复：backupPath 在场复制回来，null 则删除目标
 *     （写前本就不存在）；恢复后校验 before，不符报 verify_failed；
 *   - 当前 hash = before → 幂等 already_before（零改动）；
 *   - 其余 → refused_drift（第三方漂移，拒绝动盘）。
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** 内容 SHA-256（hex） */
export function hashConfigContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface ConfigFingerprint {
  /** config.yml 的绝对路径（harness 内部解析） */
  targetPath: string;
  /** 内容 SHA-256；目标不存在 = null */
  hash: string | null;
}

/** 读 config.yml 指纹（只读，不创建文件） */
export function fingerprintConfig(projectRoot: string): ConfigFingerprint {
  const targetPath = path.join(projectRoot, '.harness', 'config.yml');
  const hash = fs.existsSync(targetPath) ? hashConfigContent(fs.readFileSync(targetPath)) : null;
  return { targetPath, hash };
}

/**
 * 写前磁盘备份：目标在场 → 复制为 `<path>.bak-<ISO 时间戳>`（冒号/点转横线）并返回
 * 备份路径；目标不存在（新建场景）→ 无需备份，返回 null。
 */
export function backupConfigFile(configPath: string, now: Date = new Date()): string | null {
  if (!fs.existsSync(configPath)) return null;
  const backupPath = configPath + '.bak-' + now.toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

/** 观察期恢复入参（消费方持久化的观察记录同形） */
export interface ConfigRestoreRequest {
  /** apply 前的内容 SHA-256；写前配置不存在 = null */
  beforeHash: string | null;
  /** apply 落盘后的内容 SHA-256；写后配置不存在 = null */
  afterHash: string | null;
  /** 观察期备份路径；写前配置不存在 = null（恢复 = 删除目标） */
  backupPath: string | null;
}

/**
 * 观察期备份元数据（retire/disable `createBackup` 请求时返回，下游配置公共化）：
 * 恢复入参 + 目标路径，可直接经 `restoreConfig` 条件回滚
 */
export interface ConfigObservation extends ConfigRestoreRequest {
  /** config.yml 的绝对路径 */
  targetPath: string;
}

export type ConfigRestoreStatus = 'restored' | 'already_before' | 'refused_drift' | 'verify_failed';

export interface ConfigRestoreResult {
  targetPath: string;
  status: ConfigRestoreStatus;
  /** 操作后目标当前 SHA-256（目标不存在 = null） */
  hash: string | null;
}

/**
 * 条件恢复 config.yml 到 before 状态。当前内容只在「确为 after 状态」时恢复，
 * 已是 before 幂等返回，其余（第三方漂移）拒绝动盘。恢复动作的预期 I/O 失败
 * （备份缺失/不可读等）不裸抛——返回 verify_failed 与可取得的当前 hash。
 */
export function restoreConfig(projectRoot: string, request: ConfigRestoreRequest): ConfigRestoreResult {
  const { targetPath } = fingerprintConfig(projectRoot);
  const currentHash = fs.existsSync(targetPath) ? hashConfigContent(fs.readFileSync(targetPath)) : null;

  if (currentHash === request.beforeHash) {
    return { targetPath, status: 'already_before', hash: currentHash };
  }
  if (currentHash !== request.afterHash) {
    return { targetPath, status: 'refused_drift', hash: currentHash };
  }

  // 预期 I/O 失败（备份缺失/不可读等）不裸抛：报 verify_failed 并带上可取得的
  // 当前 hash（恢复未发生，目标仍是 after 内容），由调用方决定后续处置。
  // 备份先整读进内存再落盘——copyFileSync 失败会先截断/清掉目标（Node 实测），
  // 坏 backupPath 不能连带毁掉配置现状
  try {
    if (request.backupPath !== null) {
      const backupContent = fs.readFileSync(request.backupPath);
      fs.writeFileSync(targetPath, backupContent);
    } else {
      fs.rmSync(targetPath, { force: true });
    }
  } catch {
    const current = fs.existsSync(targetPath) ? hashConfigContent(fs.readFileSync(targetPath)) : null;
    return { targetPath, status: 'verify_failed', hash: current };
  }

  const restoredHash = fs.existsSync(targetPath) ? hashConfigContent(fs.readFileSync(targetPath)) : null;
  if (restoredHash !== request.beforeHash) {
    return { targetPath, status: 'verify_failed', hash: restoredHash };
  }
  return { targetPath, status: 'restored', hash: restoredHash };
}
