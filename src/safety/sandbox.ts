/**
 * Sandbox 安全级别管理
 *
 * 四级权限模型：
 * Level 1: 只读文件系统，无网络，无 shell
 * Level 2: 可写限定目录（.harness/），无网络
 * Level 3: 可写项目目录，受限网络（白名单）
 * Level 4: 完全权限，需用户确认
 */

import type { SandboxLevel, SandboxConfig, SandboxCheckResult } from './types';

const LEVEL_DESCRIPTIONS: Record<SandboxLevel, string> = {
  1: '只读文件系统，无网络，无 shell',
  2: '可写限定目录（.harness/），无网络',
  3: '可写项目目录，受限网络（白名单）',
  4: '完全权限，需用户确认',
};

const DEFAULT_WRITABLE_DIRS = ['.harness/'];

export class Sandbox {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      level: config?.level ?? 3,
      writableDirs: config?.writableDirs ?? DEFAULT_WRITABLE_DIRS,
      allowedHosts: config?.allowedHosts ?? [],
      requiresConfirmation: config?.requiresConfirmation ?? (config?.level === 4),
    };
  }

  getLevel(): SandboxLevel {
    return this.config.level;
  }

  getDescription(): string {
    return LEVEL_DESCRIPTIONS[this.config.level];
  }

  /**
   * 检查当前级别是否满足操作所需级别
   */
  check(requiredLevel: SandboxLevel): SandboxCheckResult {
    const allowed = this.config.level >= requiredLevel;
    return {
      allowed,
      reason: allowed ? undefined : `当前 Level ${this.config.level} 不满足操作所需的 Level ${requiredLevel}`,
      currentLevel: this.config.level,
      requiredLevel,
    };
  }

  /**
   * 检查文件写入是否允许
   */
  checkFileWrite(filePath: string): SandboxCheckResult {
    if (this.config.level >= 3) {
      return { allowed: true, currentLevel: this.config.level, requiredLevel: 3 };
    }

    if (this.config.level >= 2) {
      const inWritableDir = this.config.writableDirs?.some(dir => filePath.startsWith(dir));
      if (inWritableDir) {
        return { allowed: true, currentLevel: this.config.level, requiredLevel: 2 };
      }
      return {
        allowed: false,
        reason: `Level 2 只允许写入 ${this.config.writableDirs?.join(', ')}`,
        currentLevel: this.config.level,
        requiredLevel: 3,
      };
    }

    return {
      allowed: false,
      reason: 'Level 1 禁止写入任何文件',
      currentLevel: this.config.level,
      requiredLevel: 2,
    };
  }

  /**
   * 检查网络访问是否允许
   */
  checkNetworkAccess(host: string): SandboxCheckResult {
    if (this.config.level >= 4) {
      return { allowed: true, currentLevel: this.config.level, requiredLevel: 4 };
    }

    if (this.config.level >= 3) {
      const allowed = this.config.allowedHosts?.includes(host) ?? false;
      return {
        allowed,
        reason: allowed ? undefined : `Host ${host} 不在白名单中`,
        currentLevel: this.config.level,
        requiredLevel: 3,
      };
    }

    return {
      allowed: false,
      reason: `Level ${this.config.level} 禁止网络访问`,
      currentLevel: this.config.level,
      requiredLevel: 3,
    };
  }

  /**
   * 检查 shell 命令是否允许
   */
  checkShellAccess(): SandboxCheckResult {
    if (this.config.level >= 3) {
      return { allowed: true, currentLevel: this.config.level, requiredLevel: 3 };
    }
    return {
      allowed: false,
      reason: `Level ${this.config.level} 禁止 shell 访问`,
      currentLevel: this.config.level,
      requiredLevel: 3,
    };
  }

  /**
   * 检查是否需要用户确认
   */
  needsConfirmation(): boolean {
    return this.config.requiresConfirmation ?? false;
  }

  /**
   * 升级到指定级别
   */
  upgradeTo(level: SandboxLevel): void {
    this.config.level = level;
    if (level === 4) {
      this.config.requiresConfirmation = true;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}
