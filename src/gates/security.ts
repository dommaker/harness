/**
 * 安全门禁
 *
 * 检查安全漏洞：
 * - npm audit
 * - 依赖漏洞
 * - 敏感信息泄露
 *
 * fail-fast：扫描输出必须是 npm audit 的 JSON；非 JSON 输出不再有
 * 「正则抠数字」的文本兜底——解析失败直接抛出（外层归一为 deny 报告）。
 */

import { execAsync } from '../utils/exec';
import { isRecord } from '../utils/guards';
import { gateResult, fromError } from './types';
import type { GateResult, GateContext, SecurityGateConfig, Gate, GateDecision } from './types';
import { decisionFromResult } from './decision';

/** 漏洞条目（报告 details 与 analyzeResult 共用形状） */
interface VulnerabilityEntry {
  name: string;
  severity: string;
  via: string;
}

/** 漏洞统计 */
interface VulnerabilityAnalysis {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  total: number;
  vulnerabilities: VulnerabilityEntry[];
}

/** npm audit（v7+ vulnerabilities 形状）单条记录已读字段 */
interface NpmVulnerability {
  name?: string;
  severity?: string;
  via?: Array<{ title?: string } | string>;
}

/** via 的首个来源标题（字符串直取，对象取 title） */
function viaTitle(via: NpmVulnerability['via']): string | undefined {
  const first = via?.[0];
  if (typeof first === 'string') return first;
  return first?.title;
}

/**
 * 安全门禁
 */
export class SecurityGate implements Gate {
  readonly id = 'security';
  order = 0;
  private config: SecurityGateConfig;

  constructor(config: Partial<SecurityGateConfig> = {}) {
    this.config = {
      // 空串归一为 undefined：`?? ''` 曾把「未提供」表示成空串，令下方 `??` 链恒停在
      // 第二级、detectScanCommand() 不可达（#138）。「未提供」的唯一表示是 undefined。
      scanCommand: config.scanCommand || undefined,
      ignoreWarnings: config.ignoreWarnings ?? false,
      ignoreDevDependencies: config.ignoreDevDependencies ?? false,
      severityThreshold: config.severityThreshold ?? 'high',
    };
  }

  /**
   * 统一门禁接口（G1）：执行细节私有，决策三态由 scan() 报告推导
   */
  async evaluate(context: GateContext): Promise<GateDecision> {
    return decisionFromResult(await this.scan(context));
  }

  /**
   * 扫描安全漏洞
   */
  async scan(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    try {
      // 三级优先级（自上而下取第一个「已提供」者）：context 覆盖 > 构造配置 > 自动探测。
      // 缺省（未给命令）落到 detectScanCommand()——本行曾因构造器兜空串而恒停在第二级（#138）。
      const scanCommand = context.securityScanCommand ??
        this.config.scanCommand ??
        this.detectScanCommand(context.projectPath);

      const result = await this.runScan(scanCommand, context.projectPath);

      // 分析结果
      const analysis = this.analyzeResult(result);

      const passed = this.isPassed(analysis);

      return gateResult(
        'security',
        passed,
        passed
          ? '安全扫描通过'
          : `发现 ${analysis.critical} 个严重漏洞, ${analysis.high} 个高危漏洞`,
        startTime,
        {
          critical: analysis.critical,
          high: analysis.high,
          moderate: analysis.moderate,
          low: analysis.low,
          total: analysis.total,
          vulnerabilities: analysis.vulnerabilities.slice(0, 10), // 只返回前 10 个
          scanCommand,
        }
      );
    } catch (error: unknown) {
      return fromError('security', '安全扫描失败', error, startTime);
    }
  }

  /**
   * 检测扫描命令
   */
  private detectScanCommand(_projectPath: string): string {
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
    } catch (error: unknown) {
      // npm audit 发现漏洞时会返回非零退出码
      // 但 stdout 仍然包含结果
      if (isRecord(error) && typeof error.stdout === 'string') {
        return error.stdout;
      }
      throw error;
    }
  }

  /**
   * 分析扫描结果：只认 npm audit v7+ 的 vulnerabilities 形状（npm 6 的
   * audit.advisories 旧格式分支已随其 EOL 删除）。
   * 输出不是合法 JSON 对象 → 抛错（不再有文本正则兜底）。
   */
  private analyzeResult(output: string): VulnerabilityAnalysis {
    let critical = 0;
    let high = 0;
    let moderate = 0;
    let low = 0;
    const vulnerabilities: VulnerabilityEntry[] = [];

    const count = (severity: string): void => {
      switch (severity) {
        case 'critical': critical++; break;
        case 'high': high++; break;
        case 'moderate': moderate++; break;
        default: low++;
      }
    };

    const raw: unknown = JSON.parse(output);
    if (!isRecord(raw)) {
      throw new Error('安全扫描输出不是 JSON 对象');
    }

    if (isRecord(raw.vulnerabilities)) {
      for (const [name, entry] of Object.entries(raw.vulnerabilities)) {
        const vuln = (isRecord(entry) ? entry : {}) as NpmVulnerability;
        const severity = vuln.severity?.toLowerCase() ?? 'low';
        count(severity);
        vulnerabilities.push({
          name,
          severity,
          via: viaTitle(vuln.via) ?? vuln.name ?? 'Unknown',
        });
      }
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
  private isPassed(analysis: VulnerabilityAnalysis): boolean {
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
    }
  }
}
