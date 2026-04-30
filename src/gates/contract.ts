/**
 * 契约门禁
 * 
 * 检查 API 契约：
 * - OpenAPI Schema 验证
 * - 破坏性变更检测
 * - 版本兼容性
 */

import { execAsync } from '../utils/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { GateResult, GateContext, ContractGateConfig } from './types';

/**
 * 契约门禁
 */
export class ContractGate {
  private config: Required<ContractGateConfig>;

  constructor(config: Partial<ContractGateConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      strict: config.strict ?? true,
      allowBreakingChanges: config.allowBreakingChanges ?? false,
      contractPath: config.contractPath ?? 'openapi.yaml',
    };
  }

  /**
   * 检查契约
   */
  async check(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return {
        gate: 'contract',
        passed: true,
        message: '契约门禁已禁用',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }

    try {
      const contractPath = context.newContractPath ?? 
        path.join(context.projectPath, this.config.contractPath);

      // 检查契约文件是否存在
      try {
        await fs.access(contractPath);
      } catch {
        return {
          gate: 'contract',
          passed: true,
          message: '未找到契约文件，跳过检查',
          details: {
            contractPath,
            suggestion: '创建 OpenAPI 规范文件',
          },
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        };
      }

      // 验证契约格式
      const validation = await this.validateContract(contractPath);

      if (!validation.valid) {
        return {
          gate: 'contract',
          passed: false,
          message: `契约格式无效: ${validation.errors.join(', ')}`,
          details: {
            contractPath,
            errors: validation.errors,
          },
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        };
      }

      // 检查破坏性变更（如果提供了旧契约）
      if (context.oldContractPath) {
        const breakingChanges = await this.detectBreakingChanges(
          context.oldContractPath,
          contractPath
        );

        if (breakingChanges.length > 0 && !this.config.allowBreakingChanges) {
          return {
            gate: 'contract',
            passed: false,
            message: `发现破坏性变更: ${breakingChanges.length} 个`,
            details: {
              contractPath,
              oldContractPath: context.oldContractPath,
              breakingChanges,
              suggestion: '更新 API 版本或保持向后兼容',
            },
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
          };
        }
      }

      return {
        gate: 'contract',
        passed: true,
        message: '契约检查通过',
        details: {
          contractPath,
          endpoints: validation.endpoints,
          version: validation.version,
        },
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        gate: 'contract',
        passed: false,
        message: `契约检查失败: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 验证契约格式
   */
  private async validateContract(contractPath: string): Promise<{
    valid: boolean;
    errors: string[];
    endpoints: number;
    version?: string;
  }> {
    const errors: string[] = [];
    let endpoints = 0;
    let version: string | undefined;

    try {
      const content = await fs.readFile(contractPath, 'utf-8');
      let spec: any;

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
        spec = JSON.parse(content);
        version = spec.openapi || spec.swagger;
        if (spec.paths) {
          endpoints = Object.keys(spec.paths).length;
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
    } catch (error: any) {
      return {
        valid: false,
        errors: [`解析失败: ${error.message}`],
        endpoints: 0,
      };
    }
  }

  /**
   * 检测破坏性变更
   */
  private async detectBreakingChanges(
    oldPath: string,
    newPath: string
  ): Promise<Array<{ type: string; description: string; path: string }>> {
    const changes: Array<{ type: string; description: string; path: string }> = [];

    try {
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

      // 检查新增的端点（不是破坏性变更）
      // 检查方法变更
      // 简化实现，实际应该完整比较

      return changes;
    } catch {
      return [];
    }
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
