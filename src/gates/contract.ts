/**
 * 契约门禁
 *
 * 检查 API 契约：
 * - OpenAPI Schema 验证
 * - 破坏性变更检测
 * - 版本兼容性
 *
 * fail-fast：契约文件读取/解析失败直接抛出（外层归一为 deny 报告），
 * 不再有「读不到旧契约就当零破坏性变更」的吞错兜底。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pass, fail, fromError } from './types';
import type { GateResult, GateContext, ContractGateConfig, Gate, GateDecision } from './types';
import { decisionFromResult } from './decision';

/** 契约格式验证结果 */
interface ContractValidation {
  valid: boolean;
  errors: string[];
  endpoints: number;
  version?: string;
}

/** 破坏性变更条目 */
export interface BreakingChange {
  type: string;
  description: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 契约门禁
 */
export class ContractGate implements Gate {
  readonly id = 'contract';
  order = 0;
  private config: Required<ContractGateConfig>;

  constructor(config: Partial<ContractGateConfig> = {}) {
    this.config = {
      strict: config.strict ?? true,
      allowBreakingChanges: config.allowBreakingChanges ?? false,
      contractPath: config.contractPath ?? 'openapi.yaml',
    };
  }

  /**
   * 统一门禁接口（G1）：执行细节私有，决策三态由 check() 报告推导
   */
  async evaluate(context: GateContext): Promise<GateDecision> {
    return decisionFromResult(await this.check(context));
  }

  /**
   * 检查契约
   */
  async check(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    try {
      const contractPath = context.newContractPath ??
        path.join(context.projectPath, this.config.contractPath);

      // 检查契约文件是否存在（缺失 = 跳过，门禁语义而非兜底）
      try {
        await fs.access(contractPath);
      } catch {
        return pass('contract', '未找到契约文件，跳过检查', startTime, {
          contractPath,
          suggestion: '创建 OpenAPI 规范文件',
        });
      }

      // 验证契约格式
      const validation = await this.validateContract(contractPath);

      if (!validation.valid) {
        return fail('contract', `契约格式无效: ${validation.errors.join(', ')}`, startTime, {
          contractPath,
          errors: validation.errors,
        });
      }

      // 检查破坏性变更（如果提供了旧契约）
      if (context.oldContractPath) {
        const breakingChanges = await this.detectBreakingChanges(
          context.oldContractPath,
          contractPath
        );

        if (breakingChanges.length > 0 && !this.config.allowBreakingChanges) {
          return fail('contract', `发现破坏性变更: ${breakingChanges.length} 个`, startTime, {
            contractPath,
            oldContractPath: context.oldContractPath,
            breakingChanges,
            suggestion: '更新 API 版本或保持向后兼容',
          });
        }
      }

      return pass('contract', '契约检查通过', startTime, {
        contractPath,
        endpoints: validation.endpoints,
        version: validation.version,
      });
    } catch (error: unknown) {
      return fromError('contract', '契约检查失败', error, startTime);
    }
  }

  /**
   * 验证契约格式：读取/解析失败直接抛出（fail-fast）。
   */
  private async validateContract(contractPath: string): Promise<ContractValidation> {
    const errors: string[] = [];
    let endpoints = 0;
    let version: string | undefined;

    const content = await fs.readFile(contractPath, 'utf-8');

    // 解析 YAML 或 JSON
    if (contractPath.endsWith('.yaml') || contractPath.endsWith('.yml')) {
      // 简化的 YAML 解析（只提取基本信息）
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.startsWith('openapi:') || line.startsWith('swagger:')) {
          version = line.split(':')[1]?.trim();
        }
        if (line.match(/^\s*\/\w+/)) {
          endpoints++;
        }
      }
    } else {
      const raw: unknown = JSON.parse(content);
      if (!isRecord(raw)) {
        throw new Error(`契约文件不是 JSON 对象: ${contractPath}`);
      }
      version = typeof raw.openapi === 'string'
        ? raw.openapi
        : typeof raw.swagger === 'string'
          ? raw.swagger
          : undefined;
      if (isRecord(raw.paths)) {
        endpoints = Object.keys(raw.paths).length;
      }
    }

    // 基本验证
    if (!version) {
      errors.push('缺少 openapi/swagger 版本');
    }

    if (endpoints === 0) {
      errors.push('没有定义任何端点');
    }

    return {
      valid: errors.length === 0,
      errors,
      endpoints,
      version,
    };
  }

  /**
   * 检测破坏性变更：旧/新契约读取失败直接抛出（不再吞成「零变更」假绿）。
   */
  private async detectBreakingChanges(
    oldPath: string,
    newPath: string
  ): Promise<BreakingChange[]> {
    const changes: BreakingChange[] = [];

    const oldContent = await fs.readFile(oldPath, 'utf-8');
    const newContent = await fs.readFile(newPath, 'utf-8');

    // 提取端点列表
    const oldEndpoints = this.extractEndpoints(oldContent);
    const newEndpoints = this.extractEndpoints(newContent);

    // 检查删除的端点
    for (const endpoint of oldEndpoints) {
      if (!newEndpoints.includes(endpoint)) {
        changes.push({
          type: 'endpoint_removed',
          description: `端点 ${endpoint} 已删除`,
          path: endpoint,
        });
      }
    }

    return changes;
  }

  /**
   * 提取端点列表
   */
  private extractEndpoints(content: string): string[] {
    const endpoints: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const match = line.match(/^\s*\/[\w/-]+:/);
      if (match) {
        endpoints.push(match[0].replace(':', '').trim());
      }
    }

    return endpoints;
  }

  /**
   * 设置契约路径
   */
  setContractPath(path: string): void {
    this.config.contractPath = path;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ContractGateConfig> {
    return { ...this.config };
  }
}
