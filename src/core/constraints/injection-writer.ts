/**
 * 治理注入段落点写入器（架构评审候选1，ADR-0011）
 *
 * 「按渲染 body 替换标记区间 + 尾换行规一」的切片数学此前手抄 4 份
 * （init.ts 三个 writer / constraints-retire 一份），落点路由读写两侧各抄一份。
 * 本模块是唯一 writer：init/retire 退化为「渲染 body + 调 writer」。
 *
 * 形状两种（排版约定不同，非"算哪些"的差异，故合法分叉）：
 * - replaceStandaloneRange：区间独立成节，END 标记后折叠为恰好一个空行
 *   （CLAUDE.md 约束段 / Output Style 段 / retire 注入段同步）
 * - replaceEnclosedRange：区间后紧跟外层收口标记（AGENTS.md PRESERVE 段内
 *   的 HARNESS_CONSTRAINTS 区间）——恰好剥一个换行，手写余文原样落回
 *
 * 半标记守护：单边缺失或顺序颠倒 → 'half'，拒写（旧实现此时或追加出双份
 * 正本或产生乱序切片，属二次损坏路径，收紧为告警交人工，见 ADR-0011）。
 *
 * 落点路由同规则一份：
 * - resolveInjectionTarget：读侧（漂移检测/retire 同步）——CLAUDE.md 有完整
 *   标记段优先（旧模型仓豁免），否则 AGENTS.md（新模型仓住 PRESERVE 段内）
 * - resolveGovernanceLanding：写侧（init 落点选择）——额外承认 CLAUDE.md
 *   无标记的 `## Governance Rules` 旧块（续写不制造双份正本）
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CONSTRAINTS_START_MARKER,
  CONSTRAINTS_END_MARKER,
} from './injection-renderer';

/** 注入段落点文件名（检测顺序即路由优先级：旧模型仓 CLAUDE.md 优先） */
export const INJECTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
export type InjectionFile = (typeof INJECTION_FILES)[number];

/** 标记区间替换结果 */
export type MarkerWrite =
  | { kind: 'updated'; content: string }
  | { kind: 'absent' }
  | { kind: 'half' };

/** 完整标记块的内容切分（inner 含首尾标记行外的全部文本，含原换行） */
export interface MarkerBlock {
  before: string;
  inner: string;
  /** 后标记之后的原文（未规一） */
  after: string;
}

export function readIfExists(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

/** 定位完整标记对：两标记俱在且顺序正确 */
function findPair(content: string, begin: string, end: string): { startIdx: number; endIdx: number } | 'absent' | 'half' {
  const startIdx = content.indexOf(begin);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 && endIdx === -1) return 'absent';
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return 'half';
  return { startIdx, endIdx };
}

/**
 * 切出完整标记块（before + begin + inner + end + after）。
 * 'absent' = 两俱无；'half' = 残缺/乱序，拒切。
 */
export function cutMarkerBlock(content: string, begin: string, end: string): MarkerBlock | 'absent' | 'half' {
  const pair = findPair(content, begin, end);
  if (pair === 'absent' || pair === 'half') return pair;
  return {
    before: content.slice(0, pair.startIdx),
    inner: content.slice(pair.startIdx + begin.length, pair.endIdx),
    after: content.slice(pair.endIdx + end.length),
  };
}

/**
 * 替换独立成节的标记区间：body 为含首尾标记的完整替换文本（以换行结尾），
 * 区间后文剥除全部前导换行、以恰好一个空行相接（幂等：重复替换结果稳定）。
 */
export function replaceStandaloneRange(content: string, begin: string, end: string, body: string): MarkerWrite {
  const pair = findPair(content, begin, end);
  if (pair === 'absent' || pair === 'half') return { kind: pair };
  const after = content.slice(pair.endIdx + end.length).replace(/^\n+/, '');
  return {
    kind: 'updated',
    content: content.slice(0, pair.startIdx) + body + (after ? '\n' + after : ''),
  };
}

/**
 * 替换后跟外层收口标记的区间：body 含首尾标记且以换行结尾（收口标记落自己行），
 * 区间后文恰好剥一个换行（外层标记拼接位），其余手写余文原样保留。
 */
export function replaceEnclosedRange(content: string, begin: string, end: string, body: string): MarkerWrite {
  const pair = findPair(content, begin, end);
  if (pair === 'absent' || pair === 'half') return { kind: pair };
  const tail = content.slice(pair.endIdx + end.length).replace(/^\n/, '');
  return {
    kind: 'updated',
    content: content.slice(0, pair.startIdx) + body + tail,
  };
}

/**
 * 读侧路由：定位含完整 HARNESS_CONSTRAINTS 标记段的文件（studio #307）。
 * detectInjectionDrift 与 retire 注入段同步共用。
 */
export function resolveInjectionTarget(
  projectRoot: string
): { file: InjectionFile; content: string; startIdx: number; endIdx: number } | null {
  for (const file of INJECTION_FILES) {
    const content = readIfExists(path.join(projectRoot, file));
    if (content === null) continue;
    const startIdx = content.indexOf(CONSTRAINTS_START_MARKER);
    const endIdx = content.indexOf(CONSTRAINTS_END_MARKER);
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      return { file, content, startIdx, endIdx };
    }
  }
  return null;
}

/**
 * 写侧路由（init 落点选择，原 setupGovernanceConstraints 内联判定收于此）：
 * CLAUDE.md 有约束标记段或有旧版 `## Governance Rules` 块 → 续写 CLAUDE.md
 * （旧模型仓豁免，不制造双份正本）；否则 AGENTS.md PRESERVE:governance。
 */
export function resolveGovernanceLanding(
  projectRoot: string
): { target: 'claude-md' | 'agents-md'; claudeContent: string | null } {
  const claudeContent = readIfExists(path.join(projectRoot, 'CLAUDE.md'));
  if (
    claudeContent !== null &&
    (claudeContent.includes(CONSTRAINTS_START_MARKER) || /^##\s+Governance Rules/m.test(claudeContent))
  ) {
    return { target: 'claude-md', claudeContent };
  }
  return { target: 'agents-md', claudeContent };
}
