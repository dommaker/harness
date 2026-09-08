/**
 * harness security 命令
 *
 * 安全门控，检查安全漏洞
 */

import chalk from 'chalk';
import { SecurityGate } from '../../gates/security';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface SecurityOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 严重性阈值 (low/moderate/high/critical) */
  severity?: 'low' | 'moderate' | 'high' | 'critical';
  /** 是否忽略警告 */
  ignoreWarnings?: boolean;
  /** 是否忽略开发依赖 */
  ignoreDevDeps?: boolean;
  /** 自定义扫描命令 */
  scanCommand?: string;
}

/**
 * 执行安全门控
 */
export async function security(
  options: SecurityOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('🔒 安全门控检查...'));

  try {
    const projectPath = options.projectPath || process.cwd();

    const gate = new SecurityGate({
      severityThreshold: options.severity || 'high',
      scanCommand: options.scanCommand,
      ignoreWarnings: options.ignoreWarnings,
      ignoreDevDependencies: options.ignoreDevDeps,
    });

    const result = await gate.scan({ projectPath, projectId: 'default' });

    log(io);
    if (result.passed) {
      log(io, chalk.green('✅ 安全门控检查通过'));
      if (result.details) {
        log(io, chalk.gray(`   critical: ${result.details.critical}, high: ${result.details.high}, moderate: ${result.details.moderate}, low: ${result.details.low}`));
      }
    } else {
      log(io, chalk.red('❌ 安全门控检查失败'));
      log(io, chalk.red(`   ${result.message}`));
      if (result.details?.vulnerabilities) {
        log(io);
        (result.details.vulnerabilities as Array<{ name: string; severity: string; via: string }>).forEach((v, i) => {
          const severityColor = getSeverityColor(v.severity);
          log(io, severityColor(`  ${i + 1}. [${v.severity.toUpperCase()}] ${v.name}`));
          log(io, chalk.gray(`     via: ${v.via}`));
        });
      }
      log(io, chalk.gray('\n   运行 harness security audit 查看详情'));
      return { kind: 'fail', reason: `security gate denied (threshold ${options.severity || 'high'}): ${result.message}` };
    }
    return { kind: 'ok' };
  } catch (error) {
    log(io);
    log(io, chalk.red(`❌ 安全检查异常: ${error instanceof Error ? error.message : String(error)}`));
    return { kind: 'fail', reason: `security scan error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 获取严重性颜色
 */
function getSeverityColor(severity: string): (text: string) => string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return chalk.red.bold;
    case 'high':
      return chalk.red;
    case 'moderate':
      return chalk.yellow;
    case 'low':
      return chalk.blue;
    default:
      return chalk.gray;
  }
}

/**
 * 运行安全审计详情
 */
export async function auditDetails(
  options: SecurityOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('🔒 安全审计详情...\n'));

  try {
    const projectPath = options.projectPath || process.cwd();

    const gate = new SecurityGate({
      severityThreshold: options.severity || 'low',
      scanCommand: options.scanCommand,
    });

    const result = await gate.scan({ projectPath, projectId: 'default' });

    if (result.passed && !result.details?.total) {
      log(io, chalk.green('✅ 未发现安全漏洞'));
      return { kind: 'ok' };
    }

    const details = result.details as any;
    if (details?.vulnerabilities?.length > 0) {
      log(io, chalk.yellow(`发现 ${details.total} 个漏洞:\n`));
      for (const v of details.vulnerabilities) {
        const severityColor = getSeverityColor(v.severity);
        log(io, severityColor(`[${v.severity.toUpperCase()}] ${v.name}`));
        log(io, chalk.gray(`  via: ${v.via}`));
        log(io);
      }
    }
    return { kind: 'ok' };
  } catch (error) {
    log(io);
    log(io, chalk.red(`❌ 安全审计异常: ${error instanceof Error ? error.message : String(error)}`));
    return { kind: 'fail', reason: `security audit error: ${error instanceof Error ? error.message : String(error)}` };
  }
}
