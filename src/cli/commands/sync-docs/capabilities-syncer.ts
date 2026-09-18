/**
 * CAPABILITIES.md 文件表格同步器（工单 22）
 *
 * 只负责文件表格格式：模块/文件/说明三列表格，增删行维护。
 * 能力清单格式（计数行）的解析与计数已收敛到 core/constraints/capabilities-parser（H2 O10-R3）。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { readCapabilitiesEntries } from '../../../core/constraints/capabilities-parser';
import type { CapabilitiesMode } from '../../../core/project-config-loader';
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
  let content: string;
  try {
    content = await fs.readFile(capabilitiesPath, 'utf-8');
  } catch {
    // 文件不存在，创建新的（module 模式生成按目录聚合的模板）
    content = generateCapabilitiesContent(currentModules, mode);
    await fs.writeFile(capabilitiesPath, content, 'utf-8');
    return;
  }

  // 如果有表格行，更新表格
  if (existingFiles.length > 0) {
    // 移除已删除文件的行（整行连行尾一起删——只清行内容会留一个空行，
    // CommonMark 据此把一张表切成若干小表，harness#171）
    if (result.removed.length > 0) {
      const deadRowRegexes = result.removed.map((removed) => {
        const escapedFile = removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    // 没有表格，追加模块表格（module 模式按目录聚合）
    content += '\n\n' + (mode === 'module' ? generateDirTable(currentModules) : generateModuleTable(currentModules));
  }

  // 表格排版收拢放在增删之后：有新行的表不会被误判为空表（#171）
  content = normalizeCapabilitiesTableLayout(content).content;

  // 更新最后更新时间
  const now = new Date().toISOString().split('T')[0];
  content = content.replace(
    /最后更新[:：].*/,
    `最后更新: ${now}`
  );

  await fs.writeFile(capabilitiesPath, content, 'utf-8');
}

/** 表格行：以 `|` 起始（表头、分隔行、数据行都算） */
const TABLE_ROW_REGEX = /^\s*\|/;

/** 表格分隔行（|------|------|） */
const TABLE_SEPARATOR_REGEX = /^\s*\|[\s:|-]+\|\s*$/;

export interface TableLayoutNormalization {
  /** 收拢后的内容 */
  content: string;
  /** 被删掉的「表格内空行」行数 */
  blankLines: number;
  /** 被收掉的「空表」（表头+分隔行且无数据行）张数 */
  emptyTables: number;
}

/**
 * 收拢 CAPABILITIES.md 的表格排版（harness#171）
 *
 * 两条规则：① 删掉夹在两个表格行之间的空行（CommonMark 会在此切断表格）；
 * ② 收掉没有数据行的表头+分隔行。表格外的空行（段落分隔）不动。
 *
 * 幂等，且 `--check` 与写模式共用此正本——判定面就是「返回内容与入参是否不同」，
 * 因此不存在「check 报了 fix 修不掉」的不收敛（ADR-0009 口径）。
 */
export function normalizeCapabilitiesTableLayout(content: string): TableLayoutNormalization {
  const lines = content.split('\n');

  // ① 收拢表格内空行：一段连续空行，两侧最近非空行都是表格行 → 整段丢弃
  const kept: string[] = [];
  let blankLines = 0;
  for (let i = 0; i < lines.length; ) {
    if (lines[i].trim() !== '') {
      kept.push(lines[i]);
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].trim() === '') end++;
    const next = end < lines.length ? lines[end] : '';
    if (TABLE_ROW_REGEX.test(kept[kept.length - 1] ?? '') && TABLE_ROW_REGEX.test(next)) {
      blankLines += end - i;
    } else {
      kept.push(...lines.slice(i, end));
    }
    i = end;
  }

  // ② 收掉空表：表头 + 分隔行后面没有数据行
  const out: string[] = [];
  let emptyTables = 0;
  for (let i = 0; i < kept.length; i++) {
    if (
      TABLE_ROW_REGEX.test(kept[i]) &&
      TABLE_SEPARATOR_REGEX.test(kept[i + 1] ?? '') &&
      !TABLE_ROW_REGEX.test(kept[i + 2] ?? '')
    ) {
      emptyTables++;
      i++;
      continue;
    }
    out.push(kept[i]);
  }

  return { content: out.join('\n'), blankLines, emptyTables };
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
    const name = d.replace(/\/$/, '').split('/').pop()!;
    return `| ${name} | ${d} | ${name} |`;
  }).join('\n');

  return `| 模块 | 文件 | 说明 |\n|------|------|------|\n${rows}`;
}

/**
 * 将 CAPABILITIES.md 文件表格折叠为目录条目（--compact 一次性迁移）
 *
 * 按文件条目（第二列）的 dirname 分组：同组 ≥2 个文件条目折叠为一行目录条目
 * （替换组内第一行、删除其余行，说明取组内第一行，为空则用目录名）；
 * 单独成组的文件行、表头、非表格文本、PRESERVE 块原样保留。
 * 已折叠的目录条目行不再匹配文件条目，故幂等。
 */
export function compactCapabilitiesContent(content: string): string {
  const lines = content.split('\n');
  const fileEntryRegex = /\.(?:ts|tsx|js|jsx)$/;
  const rowRegex = /^\|[^|]+\|[^|]+\|[^|]+\|\s*$/;

  interface TableRow {
    lineIndex: number;
    file: string;
    desc: string;
  }

  // 收集文件条目行，按 dirname 分组（无目录前缀的条目不参与折叠）
  const groups = new Map<string, TableRow[]>();
  for (let i = 0; i < lines.length; i++) {
    if (!rowRegex.test(lines[i])) continue;
    const cells = lines[i].split('|').map(c => c.trim());
    const file = cells[2] ?? '';
    if (!fileEntryRegex.test(file)) continue;
    const dir = path.posix.dirname(file);
    if (dir === '.') continue;
    const group = groups.get(dir) ?? [];
    group.push({ lineIndex: i, file, desc: cells[3] ?? '' });
    groups.set(dir, group);
  }

  const deleteLines = new Set<number>();
  for (const [dir, rows] of groups) {
    if (rows.length < 2) continue;
    const name = dir.split('/').pop()!;
    const desc = rows[0].desc || name;
    lines[rows[0].lineIndex] = `| ${name} | ${dir}/ | ${desc} |`;
    for (const row of rows.slice(1)) {
      deleteLines.add(row.lineIndex);
    }
  }

  return lines.filter((_, i) => !deleteLines.has(i)).join('\n');
}
