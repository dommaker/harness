/**
 * 命令门禁 - Command Gate
 * SEC-006: 命令黑名单
 *
 * 检查命令是否安全，防止执行危险操作
 */

import type { GateResult, CommandGateConfig, CommandBlacklistRule } from './types';

/**
 * 黑名单级别
 */
export type BlacklistLevel = 'block' | 'warn' | 'audit';

/**
 * 默认黑名单规则
 *
 * 级别说明：
 * - block: 禁止执行，直接拒绝
 * - warn: 允许执行，但记录警告
 * - audit: 允许执行，但记录审计日志
 */
export const DEFAULT_COMMAND_BLACKLIST: CommandBlacklistRule[] = [
  // ========== 系统级破坏命令 ==========
  {
    id: 'rm-rf-root',
    pattern: /\brm\s+(-[rf]+\s+)*\/\s*$/i,
    level: 'block',
    message: '禁止删除根目录',
    category: 'system',
  },
  {
    id: 'rm-rf-star',
    pattern: /\brm\s+(-[rf]+\s+)*\*+/i,
    level: 'block',
    message: '禁止通配符删除',
    category: 'system',
  },
  {
    id: 'rm-rf-home',
    pattern: /\brm\s+(-[rf]+\s+)*(~|\/home)/i,
    level: 'block',
    message: '禁止删除用户目录',
    category: 'system',
  },
  {
    id: 'rm-rf-project',
    pattern: /\brm\s+(-[rf]+\s+)*\.\s*$/i,
    level: 'block',
    message: '禁止删除当前目录',
    category: 'system',
  },

  // ========== 权限相关 ==========
  {
    id: 'chmod-777',
    pattern: /\bchmod\s+(-R\s+)?777\b/i,
    level: 'block',
    message: '禁止设置 777 权限',
    category: 'permission',
  },
  {
    id: 'chown-root',
    pattern: /\bchown\s+(-R\s+)?root\b/i,
    level: 'warn',
    message: '谨慎修改所有者为 root',
    category: 'permission',
  },

  // ========== 数据库危险命令 ==========
  {
    id: 'drop-database',
    pattern: /\bDROP\s+(DATABASE|SCHEMA)\b/i,
    level: 'block',
    message: '禁止删除数据库/Schema',
    category: 'database',
  },
  {
    id: 'drop-table',
    pattern: /\bDROP\s+TABLE\b/i,
    level: 'warn',
    message: '删除表操作需要确认',
    category: 'database',
  },
  {
    id: 'truncate-table',
    pattern: /\bTRUNCATE\s+TABLE?\b/i,
    level: 'warn',
    message: '清空表操作需要确认',
    category: 'database',
  },
  {
    id: 'delete-all',
    pattern: /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i,
    level: 'block',
    message: '禁止无条件删除',
    category: 'database',
  },

  // ========== 网络相关 ==========
  {
    id: 'iptables-flush',
    pattern: /\biptables\s+(-F|--flush)\b/i,
    level: 'block',
    message: '禁止清空防火墙规则',
    category: 'network',
  },
  {
    id: 'curl-bash',
    pattern: /\bcurl\b.*\|\s*(sudo\s+)?bash\b/i,
    level: 'block',
    message: '禁止从网络直接执行脚本',
    category: 'network',
  },
  {
    id: 'wget-bash',
    pattern: /\bwget\b.*\|\s*(sudo\s+)?bash\b/i,
    level: 'block',
    message: '禁止从网络直接执行脚本',
    category: 'network',
  },

  // ========== 特权命令 ==========
  {
    id: 'sudo-rm',
    pattern: /\bsudo\s+.*\brm\s+/i,
    level: 'block',
    message: '禁止 sudo rm',
    category: 'privilege',
  },
  {
    id: 'sudo-dd',
    pattern: /\bsudo\s+.*\bdd\b/i,
    level: 'block',
    message: '禁止 sudo dd',
    category: 'privilege',
  },
  {
    id: 'sudo-fdisk',
    pattern: /\bsudo\s+.*\b(fdisk|parted)\b/i,
    level: 'block',
    message: '禁止 sudo 磁盘分区操作',
    category: 'privilege',
  },

  // ========== 敏感文件 ==========
  {
    id: 'read-ssh-key',
    pattern: /\bcat\s+.*\/\.ssh\/(id_rsa|id_ed25519)/i,
    level: 'audit',
    message: '读取 SSH 私钥',
    category: 'sensitive',
  },
  {
    id: 'read-env',
    pattern: /\bcat\s+.*\.env\b/i,
    level: 'audit',
    message: '读取 .env 文件',
    category: 'sensitive',
  },

  // ========== 进程管理 ==========
  {
    id: 'kill-all',
    pattern: /\bkill\s+(-9\s+)?-1\b/i,
    level: 'block',
    message: '禁止杀死所有进程',
    category: 'process',
  },
  {
    id: 'killall',
    pattern: /\bkillall\s+/i,
    level: 'warn',
    message: '批量杀死进程需要确认',
    category: 'process',
  },

  // ========== 包管理 ==========
  {
    id: 'npm-uninstall-global',
    pattern: /\bnpm\s+(uninstall|remove)\s+(-g|--global)\b/i,
    level: 'warn',
    message: '卸载全局包需要确认',
    category: 'package',
  },
  {
    id: 'pip-uninstall',
    pattern: /\bpip\s+uninstall\s+/i,
    level: 'warn',
    message: '卸载 Python 包需要确认',
    category: 'package',
  },
];

/**
 * 命令门禁
 */
export class CommandGate {
  private config: Required<CommandGateConfig>;
  private blacklist: CommandBlacklistRule[];

  constructor(config: Partial<CommandGateConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      strict: config.strict ?? false,
      customBlacklist: config.customBlacklist ?? [],
      ignoreCategories: config.ignoreCategories ?? [],
    };

    // 合并默认黑名单和自定义黑名单
    this.blacklist = [
      ...DEFAULT_COMMAND_BLACKLIST,
      ...this.config.customBlacklist,
    ];
  }

  /**
   * 检查命令
   */
  async check(command: string): Promise<GateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return {
        gate: 'command',
        passed: true,
        message: '命令门禁已禁用',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }

    const result = this.checkBlacklist(command);

    return {
      gate: 'command',
      passed: result.allowed,
      message: result.allowed
        ? this.formatSuccessMessage(result)
        : this.formatBlockMessage(result),
      details: {
        blocked: result.blocked,
        warnings: result.warnings,
        audits: result.audits,
        command,
      },
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };
  }

  /**
   * 检查黑名单
   */
  private checkBlacklist(command: string): {
    allowed: boolean;
    blocked: CommandBlacklistRule[];
    warnings: CommandBlacklistRule[];
    audits: CommandBlacklistRule[];
  } {
    const blocked: CommandBlacklistRule[] = [];
    const warnings: CommandBlacklistRule[] = [];
    const audits: CommandBlacklistRule[] = [];

    for (const rule of this.blacklist) {
      // 跳过忽略的类别
      if (this.config.ignoreCategories.includes(rule.category)) {
        continue;
      }

      if (rule.pattern.test(command)) {
        switch (rule.level) {
          case 'block':
            blocked.push(rule);
            break;
          case 'warn':
            warnings.push(rule);
            break;
          case 'audit':
            audits.push(rule);
            break;
        }
      }
    }

    return {
      allowed: blocked.length === 0,
      blocked,
      warnings,
      audits,
    };
  }

  /**
   * 格式化成功消息
   */
  private formatSuccessMessage(result: {
    warnings: CommandBlacklistRule[];
    audits: CommandBlacklistRule[];
  }): string {
    const parts: string[] = ['命令检查通过'];

    if (result.warnings.length > 0) {
      parts.push(`，${result.warnings.length} 个警告`);
    }

    if (result.audits.length > 0) {
      parts.push(`，${result.audits.length} 个审计记录`);
    }

    return parts.join('');
  }

  /**
   * 格式化阻止消息
   */
  private formatBlockMessage(result: {
    blocked: CommandBlacklistRule[];
    warnings: CommandBlacklistRule[];
    audits: CommandBlacklistRule[];
  }): string {
    const lines: string[] = [];

    lines.push('命令被禁止执行：');
    for (const rule of result.blocked) {
      lines.push(`  - [${rule.id}] ${rule.message} (${rule.category})`);
    }

    return lines.join('\n');
  }

  /**
   * 快速检查（不生成完整 GateResult）
   */
  isAllowed(command: string): boolean {
    if (!this.config.enabled) return true;

    for (const rule of this.blacklist) {
      if (this.config.ignoreCategories.includes(rule.category)) {
        continue;
      }

      if (rule.level === 'block' && rule.pattern.test(command)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取命令风险等级
   */
  getRiskLevel(command: string): 'high' | 'medium' | 'low' {
    if (!this.config.enabled) return 'low';

    for (const rule of this.blacklist) {
      if (this.config.ignoreCategories.includes(rule.category)) {
        continue;
      }

      if (rule.pattern.test(command)) {
        switch (rule.level) {
          case 'block': return 'high';
          case 'warn': return 'medium';
          case 'audit': return 'low';
        }
      }
    }

    return 'low';
  }

  /**
   * 获取黑名单规则
   */
  getBlacklist(): CommandBlacklistRule[] {
    return [...this.blacklist];
  }

  /**
   * 添加自定义规则
   */
  addRule(rule: CommandBlacklistRule): void {
    this.blacklist.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(id: string): boolean {
    const index = this.blacklist.findIndex(r => r.id === id);
    if (index >= 0) {
      this.blacklist.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<CommandGateConfig> {
    return { ...this.config };
  }
}

// ========== 便捷函数 ==========

/**
 * 创建命令门禁
 */
export function createCommandGate(config?: Partial<CommandGateConfig>): CommandGate {
  return new CommandGate(config);
}

/**
 * 默认实例
 */
let defaultCommandGate: CommandGate | null = null;

/**
 * 获取默认命令门禁
 */
export function getCommandGate(): CommandGate {
  if (!defaultCommandGate) {
    defaultCommandGate = new CommandGate();
  }
  return defaultCommandGate;
}

/**
 * 快速检查命令是否允许
 */
export function isCommandAllowed(command: string): boolean {
  return getCommandGate().isAllowed(command);
}

/**
 * 快速获取命令风险等级
 */
export function getCommandRiskLevel(command: string): 'high' | 'medium' | 'low' {
  return getCommandGate().getRiskLevel(command);
}
