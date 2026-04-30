/**
 * 跨工程接口契约检查
 *
 * 检测多工程开发时的接口不一致问题
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

// 工程依赖关系图
const PROJECT_DEPENDENCIES: Record<string, string[]> = {
  'agent-studio': ['agent-runtime', 'harness'],
  'agent-runtime': ['harness', 'agent-workflows'],
  'agent-workflows': ['harness'],
  'harness': [],
};

// 接口契约定义位置
const CONTRACT_LOCATIONS: Record<string, string[]> = {
  'studio-runtime': [
    'agent-runtime/src/api/types.ts',      // runtime 导出的 API 类型
    'agent-studio/src/services/runtime-client.ts', // studio 调用 runtime 的客户端
  ],
  'runtime-harness': [
    'harness/src/index.ts',                // harness 导出
    'agent-runtime/src/core/harness-adapter.ts',   // runtime 使用 harness
  ],
};

/**
 * 检查跨工程接口一致性
 */
export async function checkCrossProjectContracts(
  context: CrossProjectContext
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];

  // 1. 检查 API 变更是否同步到调用方
  violations.push(...await checkApiSync(context));

  // 2. 检查类型定义一致性
  violations.push(...await checkTypeConsistency(context));

  // 3. 检查破坏性变更
  violations.push(...await checkBreakingChanges(context));

  return violations;
}

/**
 * 检查 API 变更同步
 * 场景：改了 runtime API，studio 没更新
 */
async function checkApiSync(context: CrossProjectContext): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];

  // 检查 runtime API 变更
  if (context.changedProjects.includes('agent-runtime')) {
    const runtimeApiChanges = await getApiChanges('agent-runtime', context.baseBranch);
    
    for (const change of runtimeApiChanges) {
      // 检查 studio 是否同步更新
      const studioUpdated = context.changedFiles.some(f => 
        f.includes('agent-studio/src/services/') ||
        f.includes('agent-studio/src/api/')
      );

      if (!studioUpdated && isPublicApi(change)) {
        violations.push({
          type: 'api-mismatch',
          severity: 'error',
          message: `Runtime API '${change.name}' 变更未同步到 Studio`,
          fromProject: 'agent-runtime',
          toProject: 'agent-studio',
          details: {
            interfaceName: change.name,
            location: change.file,
          },
        });
      }
    }
  }

  return violations;
}

/**
 * 检查类型定义一致性
 * 场景：同一接口在不同工程定义不一致
 */
async function checkTypeConsistency(context: CrossProjectContext): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];
  
  // 检查 harness 类型是否在 runtime 中一致使用
  const harnessTypes = extractExportedTypes('harness');
  const runtimeUsage = extractTypeUsage('agent-runtime', harnessTypes);
  
  for (const [typeName, usage] of Object.entries(runtimeUsage)) {
    if (usage.hasMismatch) {
      violations.push({
        type: 'doc-code-mismatch',
        severity: 'error',
        message: `类型 '${typeName}' 在 runtime 中的使用与 harness 定义不一致`,
        fromProject: 'harness',
        toProject: 'agent-runtime',
        details: {
          interfaceName: typeName,
          expectedType: usage.expected,
          actualType: usage.actual,
        },
      });
    }
  }

  return violations;
}

/**
 * 检查破坏性变更
 */
async function checkBreakingChanges(context: CrossProjectContext): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];

  for (const project of context.changedProjects) {
    const dependents = getDependents(project);
    
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

function getDependents(project: string): string[] {
  return Object.entries(PROJECT_DEPENDENCIES)
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
