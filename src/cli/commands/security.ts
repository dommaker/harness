/**
 * harness security 命令
 *
 * 安全门控，检查安全漏洞
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
export async function security(options: SecurityOptions): Promise<void> {
  console.log(chalk.blue('🔒 安全门控检查...'));

  const projectPath = options.projectPath || process.cwd();
  const severityThreshold = options.severity || 'high';

  try {
    // 运行 npm audit
    const { stdout } = await execAsync('npm audit --json', { cwd: projectPath });
    const auditResult = JSON.parse(stdout);

    // 过滤漏洞
    const severityOrder = ['low', 'moderate', 'high', 'critical'];
    const thresholdIndex = severityOrder.indexOf(severityThreshold);

    const vulnerabilities = Object.entries(auditResult.vulnerabilities || {})
      .filter(([_, vuln]: [string, any]) => {
        const severityIndex = severityOrder.indexOf(vuln.severity);
        return severityIndex >= thresholdIndex;
      });

    if (vulnerabilities.length === 0) {
      console.log();
      console.log(chalk.green('✅ 安全门控检查通过'));
      console.log(chalk.gray('   未发现安全漏洞'));
    } else {
      console.log();
      console.log(chalk.red('❌ 安全门控检查失败'));
      console.log(chalk.red(`   发现 ${vulnerabilities.length} 个安全漏洞:\n`));

      vulnerabilities.forEach(([name, vuln]: [string, any], i: number) => {
        const severityColor = getSeverityColor(vuln.severity);
        console.log(severityColor(`${i + 1}. [${vuln.severity.toUpperCase()}] ${name}`));
        console.log(chalk.gray(`   通过: ${vuln.via?.map((x: any) => x.name || x).join(', ') || '未知'}`));
        if (vuln.fixAvailable) {
          console.log(chalk.green(`   可修复: npm audit fix`));
        }
        console.log();
      });

      process.exit(1);
    }
  } catch (error: any) {
    // npm audit 在有漏洞时返回非零退出码，需要解析 stdout
    if (error.stdout) {
      try {
        const auditResult = JSON.parse(error.stdout);
        if (auditResult.vulnerabilities && Object.keys(auditResult.vulnerabilities).length > 0) {
          console.log();
          console.log(chalk.red('❌ 安全门控检查失败'));
          console.log(chalk.red(`   发现 ${Object.keys(auditResult.vulnerabilities).length} 个安全漏洞`));
          console.log(chalk.gray('   运行 harness security audit 查看详情'));
          process.exit(1);
        }
      } catch {
        // JSON 解析失败
      }
    }

    console.log();
    console.log(chalk.red('❌ 安全门控检查出错'));
    console.log(chalk.red(`   ${error.message}`));
    process.exit(1);
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
 * 运行 npm audit 并返回详细报告
 */
export async function auditDetails(options: SecurityOptions): Promise<void> {
  console.log(chalk.blue('🔒 安全审计详情...\n'));

  const projectPath = options.projectPath || process.cwd();

  try {
    const { stdout } = await execAsync('npm audit --json', { cwd: projectPath });
    const auditResult = JSON.parse(stdout);

    if (!auditResult.vulnerabilities || Object.keys(auditResult.vulnerabilities).length === 0) {
      console.log(chalk.green('✅ 未发现安全漏洞'));
      return;
    }

    console.log(chalk.yellow(`发现 ${Object.keys(auditResult.vulnerabilities).length} 个漏洞:\n`));

    for (const [name, vuln] of Object.entries(auditResult.vulnerabilities)) {
      const v = vuln as any;
      console.log(chalk.cyan(`${name}@${v.via?.[0]?.range || 'unknown'}`));
      console.log(chalk.gray(`  严重性: ${v.severity}`));

      if (v.via && v.via.length > 0) {
        console.log(chalk.gray(`  通过: ${v.via.map((x: any) => x.name || x).join(', ')}`));
      }

      if (v.fixAvailable) {
        console.log(chalk.green(`  可修复: npm audit fix`));
      } else {
        console.log(chalk.yellow(`  需手动修复`));
      }
      console.log();
    }
  } catch (error: any) {
    if (error.stdout) {
      const auditResult = JSON.parse(error.stdout);
      if (auditResult.vulnerabilities) {
        console.log(chalk.yellow(`发现 ${Object.keys(auditResult.vulnerabilities).length} 个漏洞:\n`));
        for (const [name, vuln] of Object.entries(auditResult.vulnerabilities)) {
          const v = vuln as any;
          console.log(chalk.cyan(`${name}`));
          console.log(chalk.gray(`  严重性: ${v.severity}`));
          if (v.fixAvailable) {
            console.log(chalk.green(`  可修复: npm audit fix`));
          }
          console.log();
        }
        return;
      }
    }
    console.log(chalk.red(`❌ 安全审计失败: ${error.message}`));
  }
}
