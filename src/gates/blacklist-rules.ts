/**
 * 命令黑名单规则表（纯数据，SEC-006）
 *
 * 自 `command.ts` 拆出（重构班次 3 Phase 4：数据与判定本体分文件）；
 * 判定本体（match/judge/三投影）在 `command.ts`，消费方进口经 command.ts
 * re-export 保持不变。
 */

import type { CommandBlacklistRule } from './types';

/**
 * 默认黑名单规则
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

  // ========== git 破坏类（ADR-0031，票08 P1-6：只补不可逆损失面） ==========
  {
    id: 'git-push-force',
    pattern: /\bgit\s+push\b[^|;&]*(--force\b|-f\b)/i,
    level: 'block',
    message: '禁止强推远程（覆盖共享历史不可逆）',
    category: 'git',
  },
  {
    id: 'git-clean-force',
    pattern: /\bgit\s+clean\b[^|;&]*-[a-z]*f/i,
    level: 'block',
    message: '禁止 git clean -f（未跟踪文件删除不可恢复）',
    category: 'git',
  },
  {
    id: 'git-reset-hard',
    pattern: /\bgit\s+reset\s+--hard\b/i,
    level: 'warn',
    message: 'git reset --hard 丢弃未提交改动，需要确认',
    category: 'git',
  },
  {
    id: 'git-checkout-discard',
    pattern: /\bgit\s+checkout\s+--\s/i,
    level: 'warn',
    message: 'git checkout -- 丢弃工作区改动，需要确认',
    category: 'git',
  },
  {
    id: 'git-branch-force-delete',
    pattern: /\bgit\s+branch\s+-D\b/,
    level: 'warn',
    message: 'git branch -D 强制删分支（未合并提交可能丢失），需要确认',
    category: 'git',
  },
  {
    id: 'git-history-rewrite',
    pattern: /\bgit\s+(filter-branch|filter-repo)\b/i,
    level: 'warn',
    message: '历史重写操作不可逆，需要确认',
    category: 'git',
  },
  {
    id: 'git-reflog-expire',
    pattern: /\bgit\s+reflog\s+expire\b/i,
    level: 'warn',
    message: 'reflog expire 拆除恢复网，需要确认',
    category: 'git',
  },
];
