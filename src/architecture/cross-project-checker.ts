/**
 * 跨工程接口契约检查
 *
 * 检测多工程开发时的接口不一致问题
 *
 * 可通过 CrossProjectConfig 自定义工程依赖关系和契约位置，
 * 使此模块适用于任意多工程项目，而非仅限于 agent-studio 生态。
 */

import { runCommand } from '../utils/exec';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

export interface CrossProjectViolation {
  type: 'api-mismatch' | 'doc-code-mismatch' | 'breaking-change' | 'missing-implementation';
  severity: 'error' | 'warning';
  message: string;
  fromProject: string;
  toProject: string;
  details: {
    interfaceName?: string;
    fieldName?: string;
    expectedType?: string;
    actualType?: string;
    location?: string;
  };
}

export interface CrossProjectContext {
  baseBranch: string;
  changedProjects: string[];
  changedFiles: string[];
}

/**
 * 跨工程检查配置
 *
 * 允许调用方自定义工程依赖关系和契约位置，
 * 而非使用硬编码的默认值。
 */
export interface CrossProjectConfig {
  /** 工程依赖关系图：project -> 它依赖的项目列表 */
  dependencies: Record<string, string[]>;
  /** 接口契约定义位置：pair name -> 文件路径列表 */
  contractLocations: Record<string, string[]>;
}

// 默认配置（向后兼容）
const DEFAULT_PROJECT_DEPENDENCIES: Record<string, string[]> = {
  'agent-studio': ['agent-runtime', 'harness'],
  'agent-runtime': ['harness', 'agent-workflows'],
  'agent-workflows': ['harness'],
  'harness': [],
};

const DEFAULT_CONTRACT_LOCATIONS: Record<string, string[]> = {
  'studio-runtime': [
    'agent-runtime/src/api/types.ts',
    'agent-studio/src/services/runtime-client.ts',
  ],
  'runtime-harness': [
    'harness/src/index.ts',
    'agent-runtime/src/core/harness-adapter.ts',
  ],
};

/**
 * 检查跨工程接口一致性
 *
 * @param context 跨工程上下文
 * @param config 可选配置，允许自定义工程依赖关系和契约位置
 */
export async function checkCrossProjectContracts(
  context: CrossProjectContext,
  config?: CrossProjectConfig
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];
  const cfg = config || {
    dependencies: DEFAULT_PROJECT_DEPENDENCIES,
    contractLocations: DEFAULT_CONTRACT_LOCATIONS,
  };

  // 1. 检查 API 变更是否同步到调用方
  violations.push(...await checkApiSync(context, cfg));

  // 2. 检查类型定义一致性
  violations.push(...await checkTypeConsistency(context, cfg));

  // 3. 检查破坏性变更
  violations.push(...await checkBreakingChanges(context, cfg));

  return violations;
}

/**
 * 检查 API 变更同步
 */
async function checkApiSync(
  context: CrossProjectContext,
  config: CrossProjectConfig
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];

  for (const project of context.changedProjects) {
    const dependents = getDependents(project, config);
    const apiChanges = await getApiChanges(project, context.baseBranch);

    for (const change of apiChanges) {
      for (const dependent of dependents) {
        const dependentUpdated = context.changedFiles.some(f =>
          f.includes(`${dependent}/src/`)
        );

        if (!dependentUpdated && isPublicApi(change)) {
          violations.push({
            type: 'api-mismatch',
            severity: 'error',
            message: `'${project}' API '${change.name}' 变更未同步到 '${dependent}'`,
            fromProject: project,
            toProject: dependent,
            details: {
              interfaceName: change.name,
              location: change.file,
            },
          });
        }
      }
    }
  }

  return violations;
}

/**
 * 检查类型定义一致性
 */
async function checkTypeConsistency(
  context: CrossProjectContext,
  config: CrossProjectConfig
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];

  for (const [pair, locations] of Object.entries(config.contractLocations)) {
    const [from, to] = pair.split('-');
    if (!context.changedProjects.includes(from) && !context.changedProjects.includes(to)) {
      continue;
    }

    const fromTypes = extractExportedTypes(from);
    const toUsage = extractTypeUsage(to, fromTypes);

    for (const [typeName, usage] of Object.entries(toUsage)) {
      if (usage.hasMismatch) {
        violations.push({
          type: 'doc-code-mismatch',
          severity: 'error',
          message: `类型 '${typeName}' 在 ${to} 中的使用与 ${from} 定义不一致`,
          fromProject: from,
          toProject: to,
          details: {
            interfaceName: typeName,
            expectedType: usage.expected,
            actualType: usage.actual,
          },
        });
      }
    }
  }

  return violations;
}

/**
 * 检查破坏性变更
 */
async function checkBreakingChanges(
  context: CrossProjectContext,
  config: CrossProjectConfig
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];

  for (const project of context.changedProjects) {
    const dependents = getDependents(project, config);
    
    for (const change of await getApiChanges(project, context.baseBranch)) {
      if (isBreakingChange(change)) {
        // 检查所有依赖方是否已适配
        for (const dependent of dependents) {
          const adapted = context.changedProjects.includes(dependent);
          if (!adapted) {
            violations.push({
              type: 'breaking-change',
              severity: 'error',
              message: `破坏性变更 '${change.name}' 需要 ${dependent} 适配`,
              fromProject: project,
              toProject: dependent,
              details: {
                interfaceName: change.name,
                location: change.file,
              },
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * 检查文档-代码一致性
 * 场景：文档写了接口，代码没实现
 */
export async function checkDocCodeConsistency(
  docPath: string,
  projects: string[]
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];
  
  // 解析文档中的接口定义
  const docInterfaces = parseDocInterfaces(docPath);
  
  for (const [project, interfaces] of Object.entries(docInterfaces)) {
    if (!projects.includes(project)) continue;
    
    const actualExports = extractExportedApis(project);
    
    for (const docInterface of interfaces) {
      const implemented = actualExports.find(e => e.name === docInterface.name);
      
      if (!implemented) {
        violations.push({
          type: 'missing-implementation',
          severity: 'error',
          message: `文档接口 '${docInterface.name}' 在 ${project} 中未实现`,
          fromProject: 'documentation',
          toProject: project,
          details: {
            interfaceName: docInterface.name,
            location: docPath,
          },
        });
      } else if (!isCompatible(docInterface, implemented)) {
        violations.push({
          type: 'doc-code-mismatch',
          severity: 'warning',
          message: `接口 '${docInterface.name}' 实现与文档不一致`,
          fromProject: 'documentation',
          toProject: project,
          details: {
            interfaceName: docInterface.name,
            expectedType: JSON.stringify(docInterface.signature),
            actualType: JSON.stringify(implemented.signature),
          },
        });
      }
    }
  }

  return violations;
}

// ============ 辅助函数 ============

async function getApiChanges(project: string, baseBranch: string): Promise<ApiChange[]> {
  try {
    const output = await runCommand(
      `git diff ${baseBranch}...HEAD --name-only -- "projects/${project}/src/api/**/*"`
    );
    
    return output.trim().split('\n').filter(f => f).map(f => ({
      file: f,
      name: extractApiName(f),
      changeType: detectChangeType(f),
    }));
  } catch {
    return [];
  }
}

function isPublicApi(change: ApiChange): boolean {
  // 检查是否为公开 API（导出、非内部）
  return !change.name.startsWith('_') && !change.file.includes('/internal/');
}

function isBreakingChange(change: ApiChange): boolean {
  // 检测是否为破坏性变更
  return change.changeType === 'remove' || 
         change.changeType === 'signature-change' ||
         change.changeType === 'rename';
}

function getDependents(project: string, config: CrossProjectConfig): string[] {
  return Object.entries(config.dependencies)
    .filter(([_, deps]) => deps.includes(project))
    .map(([name, _]) => name);
}

interface ApiChange {
  file: string;
  name: string;
  changeType: 'add' | 'remove' | 'modify' | 'rename' | 'signature-change';
}

// 占位函数（需要具体实现）
function extractApiName(file: string): string {
  return path.basename(file, '.ts');
}

function detectChangeType(file: string): ApiChange['changeType'] {
  return 'modify';
}

function extractExportedTypes(project: string): string[] {
  return [];
}

function extractTypeUsage(project: string, types: string[]): Record<string, any> {
  return {};
}

function parseDocInterfaces(docPath: string): Record<string, Array<{name: string, signature: any}>> {
  return {};
}

function extractExportedApis(project: string): Array<{name: string, signature: any}> {
  return [];
}

function isCompatible(doc: any, actual: any): boolean {
  return JSON.stringify(doc.signature) === JSON.stringify(actual.signature);
}
