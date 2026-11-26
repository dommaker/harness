/**
 * required_dirs 标记段公共读写（下游配置公共化）
 *
 * 把消费方「`# AUTO-GENERATED:required_dirs` 标记段」的段编辑能力收进 harness，
 * 供公共接口完成 required_dirs 的读 / 改 / 只读漂移检查：
 *
 * - 标记段 = begin/end 两行标记之间（标记行本身视为段外）；
 * - 段外内容与注释逐字节保留（重写只发生在两行标记之间）；
 * - 段内缩进沿用既有 `required_dirs:` 行的缩进（段内无该行时回落 4 空格——
 *   `governance.context_files.required_dirs` 的惯用缩进），不硬编码；
 * - 缺标记 / 标记顺序错误（含 end 在 begin 前）抛 `RequiredDirsMarkerError`；
 * - update 幂等：清单已是最新时零写盘（mtime 不动）；
 * - check 全程零写盘：配置缺失 = 漂移（matches:false），标记损坏 fail-loud 抛错。
 */

import * as fs from 'fs';
import * as path from 'path';

/** 标记段起止标记（消费方配置文件须成对出现） */
export const REQUIRED_DIRS_BEGIN = '# AUTO-GENERATED:required_dirs';
export const REQUIRED_DIRS_END = '# /AUTO-GENERATED:required_dirs';

/** 标记段缺失 / 顺序错误 / 配置缺失的 fail-loud 错误（调用方可按类判型） */
export class RequiredDirsMarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequiredDirsMarkerError';
  }
}

export interface RequiredDirsReadResult {
  /** config.yml 的绝对路径（harness 内部解析，消费方不拼 `.harness/` 布局） */
  targetPath: string;
  /** 标记段内解析出的 required_dirs 清单（段内无条目 = 空数组） */
  dirs: string[];
}

export interface RequiredDirsUpdateResult extends RequiredDirsReadResult {
  /** 是否实际写盘（幂等命中 = false 且零写盘） */
  changed: boolean;
}

export interface RequiredDirsCheckResult {
  targetPath: string;
  /** 本次期望清单（入参原样） */
  expected: string[];
  /** 磁盘现状（标记段内清单；配置缺失 = []） */
  actual: string[];
  /** true = 磁盘与期望一致；check 全程零写盘 */
  matches: boolean;
}

interface MarkerSpan {
  /** begin 标记行内容之后的位置（含其换行） */
  blockStart: number;
  /** end 标记行的行首位置 */
  blockEnd: number;
}

function resolveConfigPath(projectRoot: string): string {
  return path.join(projectRoot, '.harness', 'config.yml');
}

function locateMarkers(content: string, targetPath: string): MarkerSpan {
  const beginIdx = content.indexOf(REQUIRED_DIRS_BEGIN);
  const endIdx = content.indexOf(REQUIRED_DIRS_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new RequiredDirsMarkerError(
      `${targetPath} 缺少 ${REQUIRED_DIRS_BEGIN} / ${REQUIRED_DIRS_END} 标记段或顺序错误，无法处理 required_dirs`
    );
  }
  const beginEol = content.indexOf('\n', beginIdx);
  if (beginEol === -1 || beginEol >= endIdx) {
    throw new RequiredDirsMarkerError(
      `${targetPath} 的 ${REQUIRED_DIRS_BEGIN} 标记行与结束标记同在一行，段内容为空无法安全重写`
    );
  }
  return { blockStart: beginEol + 1, blockEnd: content.lastIndexOf('\n', endIdx) + 1 };
}

function readConfigContent(targetPath: string): string | null {
  return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
}

/** 标记段内的 `required_dirs:` 行缩进；段内无该行时回落惯用 4 空格 */
function captureIndent(block: string): string {
  const match = /^([ \t]*)required_dirs:/m.exec(block);
  return match ? match[1] : '    ';
}

function parseDirs(block: string): string[] {
  const dirs: string[] = [];
  let inList = false;
  for (const line of block.split('\n')) {
    if (/^\s*required_dirs:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const item = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (item) {
      dirs.push(item[1]);
    } else if (line.trim() !== '') {
      break; // 条目区结束（键已结束或进了别的键）
    }
  }
  return dirs;
}

function renderBlock(indent: string, dirs: string[]): string {
  const list = dirs.map(d => `${indent}  - ${d}`).join('\n');
  return `${indent}required_dirs:\n${list === '' ? '' : list + '\n'}`;
}

/** 读标记段内的 required_dirs 清单（只读，零写盘）；配置缺失 / 标记损坏抛错 */
export function readRequiredDirs(projectRoot: string): RequiredDirsReadResult {
  const targetPath = resolveConfigPath(projectRoot);
  const content = readConfigContent(targetPath);
  if (content === null) {
    throw new RequiredDirsMarkerError(`${targetPath} 不存在，无法读取 required_dirs`);
  }
  const span = locateMarkers(content, targetPath);
  return { targetPath, dirs: parseDirs(content.slice(span.blockStart, span.blockEnd)) };
}

/** 重写标记段内的 required_dirs 清单；幂等零写盘；标记损坏 / 配置缺失抛错且零写盘 */
export function updateRequiredDirs(projectRoot: string, dirs: string[]): RequiredDirsUpdateResult {
  const targetPath = resolveConfigPath(projectRoot);
  const content = readConfigContent(targetPath);
  if (content === null) {
    throw new RequiredDirsMarkerError(`${targetPath} 不存在，无法重写 required_dirs`);
  }
  const span = locateMarkers(content, targetPath);
  const indent = captureIndent(content.slice(span.blockStart, span.blockEnd));
  const next = content.slice(0, span.blockStart) + renderBlock(indent, dirs) + content.slice(span.blockEnd);
  if (next === content) {
    return { targetPath, dirs: [...dirs], changed: false };
  }
  fs.writeFileSync(targetPath, next, 'utf-8');
  return { targetPath, dirs: [...dirs], changed: true };
}

/** 只读漂移检查：磁盘清单与期望清单逐字比对；全程零写盘，配置缺失 = 漂移 */
export function checkRequiredDirs(projectRoot: string, expected: string[]): RequiredDirsCheckResult {
  const targetPath = resolveConfigPath(projectRoot);
  const content = readConfigContent(targetPath);
  if (content === null) {
    return { targetPath, expected: [...expected], actual: [], matches: false };
  }
  const span = locateMarkers(content, targetPath);
  const actual = parseDirs(content.slice(span.blockStart, span.blockEnd));
  const matches = actual.length === expected.length && actual.every((d, i) => d === expected[i]);
  return { targetPath, expected: [...expected], actual, matches };
}
