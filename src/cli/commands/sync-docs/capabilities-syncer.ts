/**
 * CAPABILITIES.md 写侧（工单 22 / harness#171；P2.8 拆段：文本判定正本下沉
 * core/docs-sync/capabilities-table.ts，本文件只剩落盘维护）
 *
 * 只负责文件表格格式：模块/文件/说明三列表格，增删行维护。
 * 能力清单格式（计数行）的解析与计数已收敛到 core/constraints/capabilities-parser（H2 O10-R3）。
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { escapeRegExp } from '../../../utils/text';
import type { CapabilitiesMode } from '../../../core/constraints/governance-accessors';
import { normalizeCapabilitiesTableLayout } from '../../../core/docs-sync/capabilities-table';
import type { ModuleInfo, SyncResult } from '../../../core/docs-sync/project-reader';

/**
 * 更新 CAPABILITIES.md 文件
 *
 * module 模式（governance.capabilities.mode=module）下不再为新文件自动加表格行
 * （目录条目需人工策划登记），幽灵行剔除与「最后更新」刷新保留。
 */
export async function updateCapabilitiesFile(
  capabilitiesPath: string,
  currentModules: ModuleInfo[],
  existingFiles: string[],
  result: SyncResult,
  mode: CapabilitiesMode = 'file',
): Promise<void> {
  // 文件不存在 → 创建新的（module 模式生成按目录聚合的模板）；
  // 存在但读失败 → 抛出（fail-fast，不把 IO 故障当「不存在」覆盖重建）
  if (!existsSync(capabilitiesPath)) {
    const fresh = generateCapabilitiesContent(currentModules, mode);
    await fs.writeFile(capabilitiesPath, fresh, 'utf-8');
    return;
  }
  let content = await fs.readFile(capabilitiesPath, 'utf-8');

  // 如果有表格行，更新表格
  if (existingFiles.length > 0) {
    // 移除已删除文件的行（整行连行尾一起删——只清行内容会留一个空行，
    // CommonMark 据此把一张表切成若干小表，harness#171）。
    // 这里**不**豁免围栏代码块，与排版收拢刻意不同口径：登记条目由
    // capabilities-parser 全文扫描得出（ADR-0009），围栏内的行同样算登记项；
    // 只让删除认围栏而条目不认，块内示例行会一直被解析成幽灵条目，`--check`
    // 从此每轮都报同一个已删文件且永远修不掉。豁免要生效得连登记面一起改。
    if (result.removed.length > 0) {
      const deadRowRegexes = result.removed.map((removed) => {
        const escapedFile = escapeRegExp(removed);
        // 第二列存完整路径，basename 只在末尾出现，用 [^|]* 匹配路径前缀
        return new RegExp(`^\\|[^|]*\\|[^|]*\\b${escapedFile}\\s*\\|.*\\r?$`);
      });
      content = content
        .split('\n')
        .filter((line) => !deadRowRegexes.some((rowRegex) => rowRegex.test(line)))
        .join('\n');
    }

    // 添加新文件的行（在最后一个表格行之后）；module 模式跳过
    if (mode !== 'module' && result.added.length > 0) {
      const addedModules = currentModules.filter(m => result.added.includes(path.basename(m.file)));
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
  } else {
    // 没有表格，追加模块表格（module 模式按目录聚合）
    content += '\n\n' + (mode === 'module' ? generateDirTable(currentModules) : generateModuleTable(currentModules));
  }

  // 表格排版收拢放在增删之后：有新行的表不会被误判为空表（#171）
  content = normalizeCapabilitiesTableLayout(content).content;
  // 多余空行的清理收在收拢之后一处：收拢本身会新产出连续空行
  // （收掉一张夹在两段散文之间的空表就留下 `\n\n\n`，#171）
  content = content.replace(/\n{3,}/g, '\n\n');

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
function generateCapabilitiesContent(modules: ModuleInfo[], mode: CapabilitiesMode = 'file'): string {
  const now = new Date().toISOString().split('T')[0];
  return `# CAPABILITIES.md

> 最后更新: ${now}

---

${mode === 'module' ? generateDirTable(modules) : generateModuleTable(modules)}
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

/**
 * 生成按目录聚合的模块表格（module 模式模板）
 *
 * 每个源码子目录一行目录条目（| core | src/core/ | core |），
 * 文件直接位于源码根时聚到根目录一行。
 */
function generateDirTable(modules: ModuleInfo[]): string {
  if (modules.length === 0) return '';

  const dirs: string[] = [];
  for (const m of modules) {
    const dir = path.posix.dirname(m.file);
    const key = dir === '.' ? '' : dir + '/';
    if (key && !dirs.includes(key)) dirs.push(key);
  }

  const rows = dirs.map(d => {
    const name = path.posix.basename(d.replace(/\/$/, ''));
    return `| ${name} | ${d} | ${name} |`;
  }).join('\n');

  return `| 模块 | 文件 | 说明 |\n|------|------|------|\n${rows}`;
}
