/**
 * markdown frontmatter 解析/序列化正本（harness#89，架构评审 2026-09-02 候选10）
 *
 * `---\n<yaml>\n---\n<body>` 这一种语法此前在 knowledge 域 5 个文件里手写了 7 遍，
 * 失败语义三派并存（store 静默丢条目 / migration 记 errors / index-generator 走
 * best-effort / sdd 不要求闭合行完整 / ingest 只 strip 会把正文 `---` 误吞）。
 * 语法与失败走法在此一处定义，仓内不允许存在第二份副本。
 *
 * 语法（唯一解释）：
 * - 开界：偏移 0 处必须正好是一行 `---`（前面有空白行则不算 frontmatter）
 * - 闭界：其后第一个**独立成行**的 `---`（`---x`、`----`、缩进 `---` 均不作闭合）
 * - body：闭合行之后全部内容，紧随的一个空行被吃掉（与 join 的 `---\n\n` 包裹严格对称，
 *   保证已落盘条目 load→save 字节稳定）
 * - meta：闭合前的行经 YAML 解析，必须是 mapping
 * - CRLF 文件不按 frontmatter 处理（与收口前各消费方一致，本 module 不新增解释）
 *
 * 三种畸形输入的走法（裁决 2，用例固定在 utils/__tests__/frontmatter.test.ts）：
 * - 缺 frontmatter（无开界）→ 'absent'
 * - 空 meta（闭合前只有空白，含零宽块）→ 'absent'——零宽元数据块不承载信息，
 *   与「没有 frontmatter」同走一支，消费方按无元数据路径处理（store 视为非条目、
 *   index-generator 走 best-effort），无需上报
 * - 未闭合（有开无闭 / 闭合行不完整）→ 'malformed' + reason 'unterminated'
 * - meta 不是合法 YAML mapping（语法错、显式 null、标量或数组）→ 'malformed' + reason 'invalid-yaml'
 *
 * 消费方统一口径（裁决 2：不允许两派并存）：'malformed' 两支必须**显式上报**，
 * 禁止静默丢数据；恢复动作按消费方语义选择并在代码里写明——
 * 有结构化报告面的写报告（migration → result.errors），
 * 纯扫描型的打一行 stderr（前缀 `[harness]`，与 failure/recorder.ts 的坏行告警同构）
 * 后跳过或走 best-effort。'absent' 是合法输入，不上报。
 *
 * 序列化（裁决 3：收格式不收字段排序策略）：join 只负责包裹与 YAML dump 参数
 * （lineWidth 120，与收口前 store/migration 逐字一致）；canonical 字段序是 store 的
 * 私有策略，留在 store.toFrontmatter。
 *
 * 机械核查（期望命中数，均已实测）：
 *   grep -rnE '/\^---' src --include='*.ts' | grep -v __tests__
 *     → 期望 0 处：手写开界正则归零
 *   grep -rn "'---'" src --include='*.ts' | grep -v __tests__
 *     → 期望 1 处：本文件 DELIMITER
 *   grep -rn "yaml.load(metaText)\|yaml.dump(meta," src --include='*.ts' | grep -v __tests__
 *     → 期望 2 处：本文件 split 的 load + join 的 dump
 * 豁免清单（不属 frontmatter，不改）：markdown 生成物里的 `---` 分隔线与表格分隔行
 *   （init / sync-docs / report / constraints-report 模板）、doc-freshness 的章节定位正则
 *   （`\n---` 是章节边界）、config.yml 与 checkpoint/tasks/progress 的 yaml.dump（单 YAML/JSON 文档）。
 */

import * as yaml from 'js-yaml';

/** frontmatter 界符（整行） */
const DELIMITER = '---';

/** 与收口前 store/migration 逐字一致的 YAML dump 行宽 */
const DUMP_LINE_WIDTH = 120;

/** 'malformed' 的两支：消费方必须逐支显式处理（口径见文件头） */
export type FrontmatterMalformedReason = 'unterminated' | 'invalid-yaml';

/** frontmatter 元数据（已由 split 保证是 YAML mapping） */
export type FrontmatterMeta = Record<string, unknown>;

export type FrontmatterSplit =
  | { state: 'ok'; meta: FrontmatterMeta; body: string }
  | { state: 'absent' }
  | { state: 'malformed'; reason: FrontmatterMalformedReason; detail: string };

/**
 * 解析 markdown 的 YAML frontmatter。
 *
 * 不抛：三种畸形输入与 YAML 非法都体现在返回值 state/reason 上，由消费方按口径处置。
 */
export function splitFrontmatter(raw: string): FrontmatterSplit {
  const lines = raw.split('\n');
  if (lines[0] !== DELIMITER) return { state: 'absent' };

  const closeIndex = lines.indexOf(DELIMITER, 1);
  if (closeIndex === -1) {
    return {
      state: 'malformed',
      reason: 'unterminated',
      detail: `开界之后缺少独立成行的 ${DELIMITER} 闭合行`,
    };
  }

  const metaLines = lines.slice(1, closeIndex);
  if (metaLines.every(line => line.trim().length === 0)) return { state: 'absent' };

  const metaText = metaLines.join('\n');
  let parsed: unknown;
  try {
    parsed = yaml.load(metaText);
  } catch (error) {
    return {
      state: 'malformed',
      reason: 'invalid-yaml',
      // js-yaml 的 message 带多行代码片段，detail 只取首行描述——消费方要嵌进单行报告/stderr
      detail: (error instanceof Error ? error.message : String(error)).split('\n')[0],
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      state: 'malformed',
      reason: 'invalid-yaml',
      detail: `frontmatter 必须是 YAML mapping，实际是 ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    };
  }

  let bodyStart = closeIndex + 1;
  if (lines[bodyStart] === '') bodyStart++;

  return { state: 'ok', meta: parsed as FrontmatterMeta, body: lines.slice(bodyStart).join('\n') };
}

/**
 * 序列化为 `---\n<yaml>---\n\n<body>`（包裹格式与收口前 store/migration 逐字一致）。
 *
 * meta 的键序由调用方决定（store 保 canonical 序）；本函数只做包裹与 dump 参数。
 */
export function joinFrontmatter(meta: FrontmatterMeta, body: string): string {
  return `${DELIMITER}\n${yaml.dump(meta, { lineWidth: DUMP_LINE_WIDTH })}${DELIMITER}\n\n${body}`;
}
