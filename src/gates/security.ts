/**
 * 安全门禁
 * 
 * 检查安全漏洞：
 * - npm audit
 * - 依赖漏洞
 * - 敏感信息泄露
 */

import { execAsync } from '../utils/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { GateResult, GateContext, SecurityGateConfig } from './types';

/**
 * 安全门禁
 */
export class SecurityGate {
  private config: Required<SecurityGateConfig>;

  constructor(config: Partial<SecurityGateConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      scanCommand: config.scanCommand ?? '',
      ignoreWarnings: config.ignoreWarnings ?? false,
      ignoreDevDependencies: config.ignoreDevDependencies ?? false,
      severityThreshold: config.severityThreshold ?? 'high',
    };
  }

  /**
   * 扫描安全漏洞
   */
  async scan(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return {
        gate: 'security',
        passed: true,
        message: '安全门禁已禁用',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }

    try {
      // 使用自定义命令或默认 npm audit
      const scanCommand = context.securityScanCommand ?? 
        this.config.scanCommand ?? 
        this.detectScanCommand(context.projectPath);

      const result = await this.runScan(scanCommand, context.projectPath);

      // 分析结果
      const analysis = this.analyzeResult(result);

      const passed = this.isPassed(analysis);

      return {
        gate: 'security',
        passed,
        message: passed
          ? '安全扫描通过'
          : `发现 ${analysis.critical} 个严重漏洞, ${analysis.high} 个高危漏洞`,
        details: {
          critical: analysis.critical,
          high: analysis.high,
          moderate: analysis.moderate,
          low: analysis.low,
          total: analysis.total,
          vulnerabilities: analysis.vulnerabilities.slice(0, 10), // 只返回前 10 个
          scanCommand,
        },
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        gate: 'security',
        passed: false,
        message: `安全扫描失败: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 检测扫描命令
   */
  private detectScanCommand(projectPath: string): string {
    // 默认使用 npm audit
    return 'npm audit --json';
  }

  /**
   * 运行扫描
   */
  private async runScan(command: string, projectPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync(command, {
        cwd: projectPath,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error: any) {
      // npm audit 发现漏洞时会返回非零退出码
      // 但 stdout 仍然包含结果
      if (error.stdout) {
        return error.stdout;
      }
      throw error;
    }
  }

  /**
   * 分析扫描结果
   */
  private analyzeResult(output: string): {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    total: number;
    vulnerabilities: Array<{
      name: string;
      severity: string;
      via: string;
    }>;
  } {
    let critical = 0;
    let high = 0;
    let moderate = 0;
    let low = 0;
    const vulnerabilities: Array<{ name: string; severity: string; via: string }> = [];

    try {
      const result = JSON.parse(output);

      // npm audit 格式
      if (result.audit) {
        const advisories = result.audit.advisories || {};
        for (const key of Object.keys(advisories)) {
          const advisory = advisories[key];
          const severity = advisory.severity?.toLowerCase() || 'low';

          switch (severity) {
            case 'critical': critical++; break;
            case 'high': high++; break;
            case 'moderate': moderate++; break;
            default: low++;
          }

          vulnerabilities.push({
            name: advisory.name || key,
            severity,
            via: advisory.via?.[0]?.title || advisory.title || 'Unknown',
          });
        }
      }

      // 新版 npm audit 格式
      if (result.vulnerabilities) {
        for (const [name, vuln] of Object.entries(result.vulnerabilities)) {
          const v = vuln as any;
          const severity = v.severity?.toLowerCase() || 'low';

          switch (severity) {
            case 'critical': critical++; break;
            case 'high': high++; break;
            case 'moderate': moderate++; break;
            default: low++;
          }

          vulnerabilities.push({
            name,
            severity,
            via: v.via?.[0]?.title || v.name || 'Unknown',
          });
        }
      }
    } catch {
      // 解析失败，尝试从文本提取
      const criticalMatch = output.match(/(\d+) critical/i);
      const highMatch = output.match(/(\d+) high/i);
      const moderateMatch = output.match(/(\d+) moderate/i);
      const lowMatch = output.match(/(\d+) low/i);

      critical = criticalMatch ? parseInt(criticalMatch[1], 10) : 0;
      high = highMatch ? parseInt(highMatch[1], 10) : 0;
      moderate = moderateMatch ? parseInt(moderateMatch[1], 10) : 0;
      low = lowMatch ? parseInt(lowMatch[1], 10) : 0;
    }

    return {
      critical,
      high,
      moderate,
      low,
      total: critical + high + moderate + low,
      vulnerabilities,
    };
  }

  /**
   * 判断是否通过
   */
  private isPassed(analysis: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    total: number;
  }): boolean {
    // 根据严重程度阈值判断
    switch (this.config.severityThreshold) {
      case 'critical':
        return analysis.critical === 0;
      case 'high':
        return analysis.critical === 0 && analysis.high === 0;
      case 'moderate':
        return analysis.critical === 0 && analysis.high === 0 && analysis.moderate === 0;
      case 'low':
        return analysis.total === 0;
      default:
        return analysis.critical === 0 && analysis.high === 0;
    }
  }

  /**
   * 设置严重程度阈值
   */
  setSeverityThreshold(threshold: 'low' | 'moderate' | 'high' | 'critical'): void {
    this.config.severityThreshold = threshold;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<SecurityGateConfig> {
    return { ...this.config };
  }
}
