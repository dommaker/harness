/**
 * CAPABILITIES.md file-table 文本正本（工单 22 / harness#171；P2.8 自
 * cli/commands/sync-docs/capabilities-syncer.ts 下沉 core/docs-sync/，纯移位）：
 * 登记条目解析（parseCapabilitiesFiles）、表格排版判定（normalizeCapabilitiesTableLayout，
 * check 与 fix 共用正本）、--compact 目录条目折叠（compactCapabilitiesContent）。
 * 写侧 updateCapabilitiesFile 留在 cli/commands/sync-docs/capabilities-syncer.ts。
 * 能力清单格式（计数行）的解析与计数在 core/constraints/capabilities-parser。
 */

import * as path from 'path';
import { readCapabilitiesEntries } from '../constraints/capabilities-parser';

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
    // split('/') 恒产出 ≥1 段，末段索引恒有值
    const segments = entry.split('/');
    const value = entry.endsWith('/') ? entry : segments[segments.length - 1];
    if (!files.includes(value)) files.push(value);
  }
  return files;
}

/** 表格行：以 `|` 起始（表头、分隔行、数据行都算） */
const TABLE_ROW_REGEX = /^\s*\|/;

/** 表格分隔行（|------|------|） */
const TABLE_SEPARATOR_REGEX = /^\s*\|[\s:|-]+\|\s*$/;

/** 围栏代码块的起止行（``` / ~~~，允许缩进与信息串） */
const FENCE_LINE_REGEX = /^\s*(?:```|~~~)/;

export interface TableLayoutNormalization {
  /** 收拢后的内容 */
  content: string;
  /** 被删掉的「表格内空行」行数 */
  blankLines: number;
  /** 被收掉的「空表」（表头+分隔行且无数据行）张数 */
  emptyTables: number;
}

/** 参与排版判定的行：正文 + 是否落在围栏代码块内 */
interface LayoutLine {
  text: string;
  fenced: boolean;
}

/**
 * 按行切开并标出围栏代码块（``` / ~~~）内的行
 *
 * 只服务排版收拢：CAPABILITIES.md 是手写文档，块内长得像表格的示例行不是排版脏行，
 * 收它就是删用户正文（harness#171）。登记条目面不在此列——见 cli 侧
 * capabilities-syncer.ts「幽灵行删除不豁免围栏」的取舍注释。
 */
function parseLayoutLines(content: string): LayoutLine[] {
  const parsed: LayoutLine[] = [];
  let inFence = false;
  for (const text of content.split('\n')) {
    if (FENCE_LINE_REGEX.test(text)) {
      parsed.push({ text, fenced: true });
      inFence = !inFence;
      continue;
    }
    parsed.push({ text, fenced: inFence });
  }
  return parsed;
}

const isTableRow = (line: LayoutLine | undefined): line is LayoutLine =>
  line !== undefined && !line.fenced && TABLE_ROW_REGEX.test(line.text);

const isTableSeparator = (line: LayoutLine | undefined): boolean =>
  line !== undefined && !line.fenced && TABLE_SEPARATOR_REGEX.test(line.text);

/** 走一遍两条收拢规则（不迭代） */
function collapseTableLayoutOnce(content: string): TableLayoutNormalization {
  const parsed = parseLayoutLines(content);

  // ① 收拢表格内空行：一段连续空行，两侧最近非空行都是表格行 → 整段丢弃
  const kept: LayoutLine[] = [];
  let blankLines = 0;
  for (let i = 0; i < parsed.length; ) {
    if (parsed[i].text.trim() !== '') {
      kept.push(parsed[i]);
      i++;
      continue;
    }
    let end = i;
    while (end < parsed.length && parsed[end].text.trim() === '') end++;
    if (isTableRow(kept[kept.length - 1]) && isTableRow(parsed[end])) {
      blankLines += end - i;
    } else {
      kept.push(...parsed.slice(i, end));
    }
    i = end;
  }

  // ② 收掉空表：表头 + 分隔行后面没有数据行
  const out: string[] = [];
  let emptyTables = 0;
  for (let i = 0; i < kept.length; i++) {
    if (isTableRow(kept[i]) && isTableSeparator(kept[i + 1]) && !isTableRow(kept[i + 2])) {
      emptyTables++;
      i++;
      continue;
    }
    out.push(kept[i].text);
  }

  return { content: out.join('\n'), blankLines, emptyTables };
}

/**
 * 收拢 CAPABILITIES.md 的表格排版（harness#171）
 *
 * 两条规则：① 删掉夹在两个表格行之间的空行（CommonMark 会在此切断表格）；
 * ② 收掉没有数据行的表头+分隔行。表格外的空行（段落分隔）不动；围栏代码块内的行整体豁免。
 *
 * 规则互相制造对方的触发点（①把两张空表之间的那个空行吃掉后，②一轮只收得掉后一张），
 * 所以跑到不动点：**一次 `sync-docs` 必须把 `--check` 报出来的东西全清掉**，
 * 否则下游 CI 修完还是红的。计数 = 各轮合计（每轮只删当轮存在的行，不会重计）。
 *
 * 幂等，且 `--check` 与写模式共用此正本——判定面就是「返回内容与入参是否不同」，
 * 因此不存在「check 报了 fix 修不掉」的不收敛（ADR-0009 口径）。
 */
export function normalizeCapabilitiesTableLayout(content: string): TableLayoutNormalization {
  let current = content;
  let blankLines = 0;
  let emptyTables = 0;
  for (;;) {
    const pass = collapseTableLayoutOnce(current);
    if (pass.blankLines === 0 && pass.emptyTables === 0) {
      return { content: current, blankLines, emptyTables };
    }
    blankLines += pass.blankLines;
    emptyTables += pass.emptyTables;
    current = pass.content;
  }
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
    const name = path.posix.basename(dir);
    const desc = rows[0].desc || name;
    lines[rows[0].lineIndex] = `| ${name} | ${dir}/ | ${desc} |`;
    for (const row of rows.slice(1)) {
      deleteLines.add(row.lineIndex);
    }
  }

  return lines.filter((_, i) => !deleteLines.has(i)).join('\n');
}
