/**
 * harness security 命令
 *
 * 安全门控，检查安全漏洞
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SecurityGate } from '../../gates/security';
import { execAsync } from '../../utils/exec';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { reportGateDecision } from '../gate-command';

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

    const decision = await gate.evaluate({ projectPath });

    return reportGateDecision(
      io,
      {
        gateId: 'security',
        label: '安全门控',
        onPass: (r) =>
          r.details
            ? [chalk.gray(`   critical: ${r.details.critical}, high: ${r.details.high}, moderate: ${r.details.moderate}, low: ${r.details.low}`)]
            : [],
        onFail: (r) => {
          const lines = [chalk.gray(`   阈值: ${options.severity || 'high'}`)];
          if (r.details?.vulnerabilities) {
            lines.push('');
            (r.details.vulnerabilities as Array<{ name: string; severity: string; via: string }>).forEach((v, i) => {
              lines.push(getSeverityColor(v.severity)(`  ${i + 1}. [${v.severity.toUpperCase()}] ${v.name}`));
              lines.push(chalk.gray(`     via: ${v.via}`));
            });
          }
          lines.push(chalk.gray('\n   运行 harness security audit 查看详情'));
          return lines;
        },
      },
      decision
    );
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

// ========== security secrets：全历史机密扫描（P1-8，ADR-0031，wayfinder 票08） ==========

export interface SecretsOptions {
  /** 项目路径（= 待扫仓库根） */
  projectPath?: string;
}

/** 执行器注入缝（测试不依赖真 gitleaks 二进制） */
type ExecFn = typeof execAsync;

/** gitleaks 报告条目中允许外显的字段（Secret/Match/Entropy 等一律不读不打印） */
interface GitleaksFinding {
  File?: string;
  RuleID?: string;
  Description?: string;
}

/**
 * 全历史机密扫描（`gitleaks git`，P1-8）。
 *
 * 口径：harness 出命令包 gitleaks——二进制缺失 → skip（不 fail），CI 安装后
 * 才是真门（见 .github/workflows/harness-governance.yml 的 secrets job，
 * fetch-depth: 0 + 固定版本安装后跑本命令，与本命令同一判定口径）。
 *
 * 出口纪律：有泄露只列条数与文件（截断 20 条），**不打印密钥原文**
 * （报告里的 Secret/Match 字段从不进输出与 reason）。
 */
export async function secretsScan(
  options: SecretsOptions,
  io: CommandIO = processIO,
  execFn: ExecFn = execAsync,
): Promise<CommandResult> {
  log(io, chalk.blue('🔒 全历史机密扫描（gitleaks）...'));

  const repoRoot = options.projectPath || process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gitleaks-'));
  const reportPath = path.join(tmpDir, 'report.json');

  try {
    let exitCode = 0;
    try {
      await execFn(
        `gitleaks git --report-format json --report-path "${reportPath}" "${repoRoot}"`,
        { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (error: any) {
      // gitleaks 退出码：0 = 干净，1 = 发现泄露（报告已落盘）；127 = 二进制不存在
      exitCode = typeof error?.code === 'number' ? error.code : -1;
    }

    if (exitCode === 127) {
      log(io, chalk.yellow('⏭️  未检测到 gitleaks 二进制，跳过全历史机密扫描'));
      log(io, chalk.gray('   安装：https://github.com/gitleaks/gitleaks（CI 已接线为真门）'));
      return { kind: 'skip', reason: 'gitleaks binary not found' };
    }
    if (exitCode !== 0 && exitCode !== 1) {
      log(io, chalk.red(`❌ gitleaks 执行失败（exit ${exitCode}）`));
      return { kind: 'fail', reason: `secrets scan error: gitleaks exited ${exitCode}` };
    }

    let findings: GitleaksFinding[] = [];
    if (fs.existsSync(reportPath)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        findings = Array.isArray(parsed) ? (parsed as GitleaksFinding[]) : [];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(io, chalk.red(`❌ gitleaks 报告解析失败: ${message}`));
        return { kind: 'fail', reason: `secrets scan error: report parse failed: ${message}` };
      }
    }

    if (findings.length === 0) {
      log(io, chalk.green('✅ 全历史机密扫描通过：未发现泄露'));
      return { kind: 'ok' };
    }

    const files = [...new Set(findings.map((f) => f.File || '(unknown)'))];
    log(io, chalk.red(`❌ 发现 ${findings.length} 处疑似机密泄露（涉及 ${files.length} 个文件）:`));
    for (const file of files.slice(0, 20)) {
      log(io, chalk.gray(`   - ${file}`));
    }
    if (files.length > 20) {
      log(io, chalk.gray(`   ... 其余 ${files.length - 20} 个文件略`));
    }
    log(io, chalk.gray('   密钥原文不打印；详情用 gitleaks 本地复查，泄露凭证按已泄露处置（吊销轮换）'));
    return {
      kind: 'fail',
      reason: `secrets scan failed: ${findings.length} potential leaks in ${files.length} files`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

    const result = await gate.scan({ projectPath });

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
