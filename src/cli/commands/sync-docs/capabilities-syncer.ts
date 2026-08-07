/**
 * CAPABILITIES.md 同步器（工单 22）
 *
 * 支持两种格式：
 * - 文件表格格式：模块/文件/说明三列表格，增删行维护
 * - 能力清单格式：计数行（CLI Commands (N) 等），FreshnessRunner 校验与刷新
 */

import * as fs from 'fs/promises';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../../core/constraints/definitions';
import { readCapabilitiesEntries } from '../../../core/constraints/capabilities-parser';
import { FreshnessRunner } from '../../../core/constraints/doc-freshness/runner';
import type { DocFreshnessCheck } from '../../../types/project-config';
import type { ModuleInfo, SyncResult } from './project-reader';

/**
 * 解析 CAPABILITIES.md 中的文件路径
 *
 * 提取所有表格行中提到的 .ts/.tsx/.js/.jsx 文件名（不含路径前缀）
 * 用于模糊匹配：只要文档中提到了该文件名就算已记录
 */
export async function parseCapabilitiesFiles(capabilitiesPath: string): Promise<string[]> {
  // 工单 19-B：解析收敛到 core/constraints/capabilities-parser；
  // 此处保持原语义——文件条目取 basename，目录条目（以 / 结尾）原样保留
  const entries = readCapabilitiesEntries(capabilitiesPath, { includeDirs: true });
  const files: string[] = [];
  for (const entry of entries) {
    const value = entry.endsWith('/') ? entry : entry.split('/').pop()!;
    if (!files.includes(value)) files.push(value);
  }
  return files;
}

/**
 * 检测 CAPABILITIES.md 是否使用能力清单格式（计数行），而非文件表格格式
 */
export function isCapabilityListingFormat(content: string): boolean {
  // 能力清单格式特征：包含 "CLI Commands (N)" / "Iron Laws (N)" 等计数行
  return /CLI Commands\s*\(\d+\)/.test(content) ||
    /Iron Laws?\s*\(\d+\)/.test(content) ||
    /Guidelines?\s*\(\d+\)/.test(content);
}

/**
 * 构建 CAPABILITIES.md 能力清单格式的检查配置
 */
function buildCapabilityChecks(): DocFreshnessCheck[] {
  return [
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'CLI Commands',
      pattern: 'CLI Commands\\s*\\((\\d+)\\)',
      actual: { kind: 'dir_count', path: 'src/cli/commands', extension: '.ts', exclude: ['index.ts'] },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Quality Gates',
      pattern: 'Quality Gates?\\s*\\((\\d+)\\)',
      actual: { kind: 'dir_count', path: 'src/gates', extension: '.ts', exclude: ['index.ts', 'types.ts'] },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Iron Laws',
      pattern: 'Iron Laws?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(IRON_LAWS).length },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Guidelines',
      pattern: 'Guidelines?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(GUIDELINES).length },
    },
    {
      type: 'doc_regex_count',
      doc: 'CAPABILITIES.md',
      label: 'Tips',
      pattern: 'Tips?\\s*\\((\\d+)\\)',
      actual: { kind: 'const_count', value: Object.keys(TIPS).length },
    },
  ];
}

/**
 * 使用 FreshnessRunner 检查能力清单计数是否与代码一致（--check 模式）
 */
export function checkCapabilityCounts(
  projectPath: string
): { match: boolean; mismatches: string[] } {
  const runner = new FreshnessRunner();
  const checks = buildCapabilityChecks();
  const results = runner.runAll({ checks }, projectPath);

  const mismatches: string[] = [];
  for (const r of results) {
    if (!r.pass && r.message) {
      mismatches.push(r.message);
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

/**
 * 更新 CAPABILITIES.md 中的能力清单计数（write 模式）
 *
 * 使用 FreshnessRunner 获取实际计数，然后 regex 替换文档计数行。
 */
export function updateCapabilityCounts(content: string, projectPath: string): string {
  const runner = new FreshnessRunner();

  const cliCount = runner.countFromDir('src/cli/commands', '.ts', ['index.ts'], projectPath);
  const gateCount = runner.countFromDir('src/gates', '.ts', ['index.ts', 'types.ts'], projectPath);
  const ironCount = Object.keys(IRON_LAWS).length;
  const guideCount = Object.keys(GUIDELINES).length;
  const tipsCount = Object.keys(TIPS).length;

  const replacements: [RegExp, string][] = [
    [/CLI Commands\s*\(\d+\)/, `CLI Commands (${cliCount})`],
    [/Quality Gates?\s*\(\d+\)/, `Quality Gates (${gateCount})`],
    [/Iron Laws?\s*\(\d+\)/, `Iron Laws (${ironCount})`],
    [/Guidelines?\s*\(\d+\)/, `Guidelines (${guideCount})`],
    [/Tips?\s*\(\d+\)/, `Tips (${tipsCount})`],
  ];

  for (const [regex, replacement] of replacements) {
    if (regex.test(content)) {
      content = content.replace(regex, replacement);
    }
  }

  return content;
}

/**
 * 更新 CAPABILITIES.md 文件
 */
export async function updateCapabilitiesFile(
  capabilitiesPath: string,
  currentModules: ModuleInfo[],
  existingFiles: string[],
  result: SyncResult,
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(capabilitiesPath, 'utf-8');
  } catch {
    // 文件不存在，创建新的
    content = generateCapabilitiesContent(currentModules);
    await fs.writeFile(capabilitiesPath, content, 'utf-8');
    return;
  }

  // 如果有表格行，更新表格
  if (existingFiles.length > 0) {
    // 移除已删除文件的行
    for (const removed of result.removed) {
      const escapedFile = removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 第二列存完整路径，basename 只在末尾出现，用 [^|]* 匹配路径前缀
      const rowRegex = new RegExp(`^\\|[^|]*\\|[^|]*\\b${escapedFile}\\s*\\|.*$`, 'gm');
      content = content.replace(rowRegex, '');
    }

    // 添加新文件的行（在最后一个表格行之后）
    if (result.added.length > 0) {
      const getBasenameLocal = (f: string) => f.split('/').pop()!;
      const addedModules = currentModules.filter(m => result.added.includes(getBasenameLocal(m.file)));
      const tableEndRegex = /(^\|[^|]+\|[^|]+\|[^|]+\|\s*$)/gm;
      let lastTableRow = '';
      let match;
      while ((match = tableEndRegex.exec(content)) !== null) {
        lastTableRow = match[0];
      }

      if (lastTableRow) {
        const newRows = addedModules.map(m =>
          `| ${m.name} | ${m.file} | ${m.description} |`
        ).join('\n');
        content = content.replace(lastTableRow, lastTableRow + '\n' + newRows);
      }
    }

    // 清理多余空行
    content = content.replace(/\n{3,}/g, '\n\n');
  } else {
    // 没有表格，追加模块表格
    content += '\n\n' + generateModuleTable(currentModules);
  }

  // 更新最后更新时间
  const now = new Date().toISOString().split('T')[0];
  content = content.replace(
    /最后更新[:：].*/,
    `最后更新: ${now}`
  );

  await fs.writeFile(capabilitiesPath, content, 'utf-8');
}

/**
 * 生成 CAPABILITIES.md 内容
 */
function generateCapabilitiesContent(modules: ModuleInfo[]): string {
  const now = new Date().toISOString().split('T')[0];
  return `# CAPABILITIES.md

> 最后更新: ${now}

---

${generateModuleTable(modules)}
`;
}

/**
 * 生成模块表格
 */
function generateModuleTable(modules: ModuleInfo[]): string {
  if (modules.length === 0) return '';

  const rows = modules.map(m =>
    `| ${m.name} | ${m.file} | ${m.description} |`
  ).join('\n');

  return `| 模块 | 文件 | 说明 |\n|------|------|------|\n${rows}`;
}
