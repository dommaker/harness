/**
 * AGENTS.md PRESERVE 标记块（工单 22）
 *
 * 使用者在 AGENTS.md 中用 `<!-- PRESERVE:名称 -->` / `<!-- /PRESERVE:名称 -->`
 * 圈出的区段属于使用者自有内容：重新生成时原样保留（附于生成内容之后，保持相对顺序），
 * 漂移比对对块内改动免疫。名称仅允许字母/数字/下划线/连字符，标记须独占一行。
 */

/** PRESERVE 开始标记：独占一行，捕获名称 */
const PRESERVE_BEGIN_RE = /^<!-- PRESERVE:([A-Za-z0-9_-]+) -->\s*$/;

export interface PreserveExtraction {
  /** 完整保留块（含首尾标记行，块间不含外部空行），保持原有相对顺序 */
  blocks: string[];
  /** 未闭合（缺同名结束标记）的块名——不予保留，调用方应告警 */
  malformed: string[];
}

/**
 * 从既有 AGENTS.md 提取 PRESERVE 标记块（逐行扫描，结束标记须与开始标记同名）。
 * 块内容原样保留（含标记行）；未闭合的开始标记按普通内容处理并记入 malformed。
 */
export function extractPreserveBlocks(content: string): PreserveExtraction {
  const blocks: string[] = [];
  const malformed: string[] = [];
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(PRESERVE_BEGIN_RE);
    if (!m) {
      i++;
      continue;
    }
    const name = m[1];
    const endMarker = `<!-- /PRESERVE:${name} -->`;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== endMarker) {
      j++;
    }
    if (j >= lines.length) {
      malformed.push(name);
      i++; // 未闭合：跳过开始标记行，其余行按普通内容继续扫描
      continue;
    }
    blocks.push(lines.slice(i, j + 1).join('\n'));
    i = j + 1;
  }
  return { blocks, malformed };
}

/**
 * 组合 AGENTS.md 最终内容：生成部分在前，PRESERVE 块按原序附在文末（空行分隔）。
 * 无保留块时原样返回生成内容（与历史行为一致）；组合结果重跑幂等。
 */
export function composeAgentsMd(generated: string, blocks: string[]): string {
  if (blocks.length === 0) return generated;
  const head = generated.replace(/\s*$/, '');
  return head + '\n\n' + blocks.join('\n\n') + '\n';
}
