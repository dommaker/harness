/**
 * 跨工程接口契约检查
 *
 * 检测多工程开发时的接口不一致问题
 *
 * 可通过 CrossProjectConfig 自定义工程依赖关系和契约位置，
 * 使此模块适用于任意多工程项目，而非仅限于 agent-studio 生态。
 */

import { runCommand } from '../utils/exec';
import { existsSync, readFileSync, readdirSync } from 'fs';
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

/**
 * 检查跨工程接口一致性
 *
 * @param context 跨工程上下文
 * @param config 工程依赖关系和契约位置配置
 */
export async function checkCrossProjectContracts(
  context: CrossProjectContext,
  config: CrossProjectConfig
): Promise<CrossProjectViolation[]> {
  const violations: CrossProjectViolation[] = [];
  const cfg = config;

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

    const files = output.trim().split('\n').filter(f => f);
    return Promise.all(files.map(async (f) => ({
      file: f,
      name: extractApiName(f),
      changeType: await detectChangeType(f, baseBranch),
    })));
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

// ============ 辅助函数实现 ============

/**
 * 递归查找目录中的 .ts 文件（排除 node_modules/__tests__/dist/.d.ts）
 */
function findTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      results.push(...findTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractApiName(file: string): string {
  return path.basename(file, '.ts');
}

async function detectChangeType(file: string, baseBranch: string): Promise<ApiChange['changeType']> {
  try {
    const statusOutput = await runCommand(
      `git diff ${baseBranch}...HEAD --name-status -- "${file}"`
    );
    const statusLine = statusOutput.trim().split('\n')[0];
    if (!statusLine) return 'modify';

    const statusCode = statusLine.charAt(0);
    if (statusCode === 'A') return 'add';
    if (statusCode === 'D') return 'remove';
    if (statusCode === 'R') return 'rename';

    // M (modified) — check if export signatures changed
    if (statusCode === 'M') {
      const diff = await runCommand(`git diff ${baseBranch}...HEAD -- "${file}"`);
      const signaturePattern = /^[+-]\s*export\s+(?:async\s+)?(?:function|interface|type|class|enum)\s+\w+/m;
      if (signaturePattern.test(diff)) {
        return 'signature-change';
      }
    }

    return 'modify';
  } catch {
    return 'modify';
  }
}

function extractExportedTypes(project: string): string[] {
  const srcDir = path.join('projects', project, 'src');
  const files = findTsFiles(srcDir);
  const types = new Set<string>();

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const regex = /export\s+(?:interface|type|enum)\s+(\w+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        types.add(match[1]);
      }
    } catch {
      // 文件读取失败，跳过
    }
  }

  return [...types];
}

function extractTypeUsage(project: string, types: string[]): Record<string, { hasMismatch: boolean; expected?: string; actual?: string }> {
  const srcDir = path.join('projects', project, 'src');
  const files = findTsFiles(srcDir);
  const result: Record<string, { hasMismatch: boolean; expected?: string; actual?: string }> = {};

  for (const typeName of types) {
    let importedIn = false;
    let usedIn = false;

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        // 检查是否导入了该类型
        const importRegex = new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${typeName}\\b[^}]*\\}\\s+from`);
        if (importRegex.test(content)) {
          importedIn = true;
          // 检查是否在 import 行之外使用了该类型
          const lines = content.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('import ')) continue;
            if (new RegExp(`\\b${typeName}\\b`).test(line)) {
              usedIn = true;
              break;
            }
          }
        }
      } catch {
        // 文件读取失败，跳过
      }
    }

    // 导入但未使用 → 可能是版本不一致
    if (importedIn && !usedIn) {
      result[typeName] = { hasMismatch: true, expected: typeName, actual: 'unused import' };
    }
  }

  return result;
}

function parseDocInterfaces(docPath: string): Record<string, Array<{name: string, signature: string}>> {
  if (!existsSync(docPath)) return {};

  try {
    const content = readFileSync(docPath, 'utf-8');
    const lines = content.split('\n');
    const result: Record<string, Array<{name: string, signature: string}>> = {};
    let currentProject: string | null = null;

    for (const line of lines) {
      // 匹配 ## project-name
      const headerMatch = line.match(/^##\s+(\S[\w-]*)/);
      if (headerMatch) {
        currentProject = headerMatch[1];
        if (!result[currentProject]) result[currentProject] = [];
        continue;
      }

      // 匹配 - `functionName(params): returnType`
      if (currentProject) {
        const sigMatch = line.match(/^-\s+`([^`]+)`/);
        if (sigMatch) {
          const signature = sigMatch[1];
          const nameMatch = signature.match(/^(\w+)\s*\(/);
          const name = nameMatch ? nameMatch[1] : signature;
          result[currentProject].push({ name, signature });
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}

function extractExportedApis(project: string): Array<{name: string, signature: string}> {
  const srcDir = path.join('projects', project, 'src');
  const files = findTsFiles(srcDir);
  const apis: Array<{name: string, signature: string}> = [];
  const seen = new Set<string>();

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');

      // export function / export async function
      const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?::\s*(\S+))?/g;
      let match;
      while ((match = funcRegex.exec(content)) !== null) {
        const name = match[1];
        if (seen.has(name)) continue;
        seen.add(name);
        const params = match[2] ? match[2].trim() : '';
        const returnType = match[3] || 'void';
        apis.push({ name, signature: `${name}(${params}): ${returnType}` });
      }

      // export class
      const classRegex = /export\s+class\s+(\w+)/g;
      while ((match = classRegex.exec(content)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          apis.push({ name, signature: name });
        }
      }

      // export const arrow functions
      const arrowRegex = /export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
      while ((match = arrowRegex.exec(content)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          apis.push({ name, signature: name });
        }
      }
    } catch {
      // 文件读取失败，跳过
    }
  }

  return apis;
}

function isCompatible(doc: any, actual: any): boolean {
  return JSON.stringify(doc.signature) === JSON.stringify(actual.signature);
}
