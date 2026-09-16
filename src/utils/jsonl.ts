/**
 * append-only JSONL 日志读写正本（harness#82，架构评审 2026-09-02 候选3）
 *
 * 全仓 append-only JSONL（traces.log / failures.log / context-tracker.log /
 * references.jsonl / sessions/<id>/events.jsonl / 外部 transcript .jsonl）的
 * exists → read → split → parse → filter 读链与 ensureDir + append 写链
 * 收口于此，仓内不允许存在第二份副本。
 *
 * 坏行策略（harness#82 裁决 1）：读入口 policy 为显式必填参数，类型层面无缺省，
 * 每个调用点必须逐一声明 'skip' | 'throw'——既不让「静默丢数据」成为框架缺省，
 * 也不反转既有容错调用点的语义。坏行指非空但 JSON.parse 失败的行
 * （半写入截断、手工编辑、磁盘满等）。
 *
 * tail：从文件末尾倒着分块 seek，只把够数的尾部行读进内存。2026-09-14 量数据推翻本文件
 * 早先「文件仍全量读取，parse 才是大头」的断言：6.7MB / 32723 行的 traces.log 上，
 * 完全不 parse 的整读单次仍 16.6–21.1ms——成本在 split('\n') 与空白行过滤。
 * head：从文件头正向分块读，够数即停——供「有没有至少 N 条」这类阈值消费方，不再为
 * 一个比较符把全文捞进内存。
 * 两者同给或都不给时才整读后截断（head→tail 顺序即既有语义）。
 *
 * 计数去向（harness#100）：本模块是坏行计数的唯一正本，但正本≠终点——凡以 'skip'
 * 策略读，调用点必须把 skippedLines 带到该消费面的用户可见输出（CLI 走 stderr，
 * 结构化输出与 API 走字段），或显式记名豁免并写明理由。机器可检面：
 * `src/utils/__tests__/jsonl-skip-disposition.test.ts`（冻结站点集合 + 要求每个读点
 * 上方声明 `计数去向：`）。
 *
 * 豁免清单与机械核查（期望命中数）：
 *   grep -rnE "JSON\.parse\((line|trimmed|l)\b" src --include='*.ts' | grep -v __tests__
 *     → 期望 1 处：本文件 readJsonl（读链正本本体）
 *   grep -rn "map(JSON.parse" src --include='*.ts' | grep -v __tests__
 *     → 期望 0 处
 *   __tests__ 下的坏行 fixture 不在核查范围。
 * 其余裁决豁免：readIfExists（injection-writer，string|null 形态不同，#82 裁决 3）；
 * FailureRecorder 轮换链（文件生命周期不变量，裁决 2）；
 * 单 JSON 文档读取（package.json / .state.json / checkpoint.json / summary 等非 JSONL）。
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 坏行策略
 *
 * - 'skip'：跳过损坏行，继续解析；skippedLines 计数
 * - 'throw'：损坏行直接上抛（沿用原抛语义的调用点显式选择）
 */
export type JsonlBadLinePolicy = 'skip' | 'throw';

export interface JsonlReadResult<T> {
  records: T[];
  /**
   * 被跳过的坏行数（'throw' 策略下恒为 0）
   *
   * 拿到它不等于告知：skip 读点必须把它带到消费面的用户可见输出或记名豁免（harness#100）
   */
  skippedLines: number;
}

export interface JsonlReadOptions {
  /** 只解析最后 N 个非空行（尾部读取） */
  tail?: number;
  /** 只解析前 N 个非空行（头部读取） */
  head?: number;
}

/** exists → read → split → filter 空行的公共前缀（正本唯一一份） */
function readNonEmptyLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(line => line.trim().length > 0);
}

/** tail 倒读的分块大小：trace 行约 200B，一块即够几十行 */
const TAIL_CHUNK_BYTES = 64 * 1024;

/** head 正读的分块大小 */
const HEAD_CHUNK_BYTES = 64 * 1024;

/**
 * 从文件头正向分块读，只返回前 want 个非空行（够数即停，不整读）
 *
 * 与「整读后 slice(0, want)」逐字同语义：行以 `\n` 界定，末块无尾换行时整段收尾算一行，
 * 纯空白行不计数。块边界切在多字节字符中间时，残段按字节留在缓冲里等下一块拼齐再解码。
 * 供「有没有至少 N 条记录」这类阈值消费方——它要的是够不够，不是总数。
 */
function readHeadNonEmptyLines(filePath: string, want: number): string[] {
  if (want <= 0) return [];
  if (!fs.existsSync(filePath)) return [];

  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const kept: string[] = [];
    let acc = Buffer.alloc(0);
    let pos = 0;
    while (kept.length < want) {
      const end = Math.min(size, pos + HEAD_CHUNK_BYTES);
      if (end > pos) {
        const chunk = Buffer.alloc(end - pos);
        fs.readSync(fd, chunk, 0, end - pos, pos);
        acc = Buffer.concat([acc, chunk]);
      }
      let cursor = 0;
      for (let i = 0; i < acc.length && kept.length < want; i++) {
        if (acc[i] !== 0x0a) continue;
        const line = acc.subarray(cursor, i).toString('utf-8');
        if (line.trim().length > 0) kept.push(line);
        cursor = i + 1;
      }
      if (end >= size) {
        // 读到文件末尾：最后一段没有换行收尾，但它就是一行
        if (kept.length < want && cursor < acc.length) {
          const last = acc.subarray(cursor).toString('utf-8');
          if (last.trim().length > 0) kept.push(last);
        }
        break;
      }
      pos = end;
      acc = acc.subarray(cursor);
    }
    return kept;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 从文件末尾倒着分块读，只返回末尾 want 个非空行（文件顺序）
 *
 * 与「整读后 slice(-want)」逐字同语义：行以 `\n` 界定，末行允许无换行，`\r` 随行进文本，
 * 纯空白行不计数。左侧残段（块边界切在多字节字符中间）不解码，按字节留到下一轮——
 * UTF-8 的多字节序列不含 0x0a，故按 `\n` 切字节再解码不会破坏字符。
 */
function readTailNonEmptyLines(filePath: string, want: number): string[] {
  if (want <= 0) return [];
  if (!fs.existsSync(filePath)) return [];

  const fd = fs.openSync(filePath, 'r');
  try {
    let pos = fs.fstatSync(fd).size;
    let acc = Buffer.alloc(0);
    for (;;) {
      const start = Math.max(0, pos - TAIL_CHUNK_BYTES);
      if (pos > start) {
        const chunk = Buffer.alloc(pos - start);
        fs.readSync(fd, chunk, 0, pos - start, start);
        acc = Buffer.concat([chunk, acc]);
      }
      pos = start;

      const lines: string[] = [];
      let cursor = pos === 0 ? 0 : -1;
      for (let i = 0; i < acc.length; i++) {
        if (acc[i] !== 0x0a) continue;
        if (cursor >= 0) lines.push(acc.subarray(cursor, i).toString('utf-8'));
        cursor = i + 1;
      }
      if (cursor >= 0 && cursor < acc.length) lines.push(acc.subarray(cursor).toString('utf-8'));

      const kept = lines
        .filter(line => line.trim().length > 0)
        .slice(-want);
      // 已到文件头 → 全部行都在手里；否则末尾 want 个非空行已凑齐，左侧只可能是更早的行
      if (pos === 0 || kept.length >= want) return kept;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** parse 非空行文本（读链的末段；坏行策略同 readJsonl） */
function parseJsonlLines<T>(lines: string[], policy: JsonlBadLinePolicy): JsonlReadResult<T> {
  const records: T[] = [];
  let skippedLines = 0;
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      if (policy === 'throw') throw error;
      skippedLines++;
    }
  }
  return { records, skippedLines };
}

/**
 * 读取 JSONL 文件：exists → read → split → parse → filter（正本读链）
 *
 * policy 必填无缺省（裁决 1）；缺文件返回空结果，不抛。
 * 只给 head 走有界正读、只给 tail 走倒读 seek；两者同给或都不给走整读后截断
 * （head→tail 的截断顺序即既有语义）。
 */
export function readJsonl<T>(
  filePath: string,
  policy: JsonlBadLinePolicy,
  options?: JsonlReadOptions
): JsonlReadResult<T> {
  let lines: string[];
  if (options?.head !== undefined && options.tail === undefined) {
    lines = readHeadNonEmptyLines(filePath, options.head);
  } else if (options?.tail !== undefined && options.head === undefined) {
    lines = readTailNonEmptyLines(filePath, options.tail);
  } else {
    lines = applyHeadTail(readNonEmptyLines(filePath), options);
  }
  return parseJsonlLines<T>(lines, policy);
}

/**
 * 尾部窗口：一次分块读行文本，之后按不同 tail 口径反复取用
 *
 * 供「同一次运行里有多个消费方、各看不同长度的尾部」的场景（ADR-0023 run 内共享），
 * 取一份行文本而不是各捞一遍。`take(limit)` 与 `readJsonl(..., { tail: limit })` 逐字
 * 同口径：**先按行文本截窗再 parse**——坏行占尾部槽位不占 records 名额，若改拿大窗口的
 * records 再切，窗口内有坏行时小窗口会多收更老的有效记录，判定就变了。
 */
export interface JsonlWindow<T> {
  take(limit: number): JsonlReadResult<T>;
}

export function readJsonlWindow<T>(
  filePath: string,
  policy: JsonlBadLinePolicy,
  maxLines: number
): JsonlWindow<T> {
  const lines = readTailNonEmptyLines(filePath, maxLines);
  return {
    take: (limit: number) => {
      if (limit > maxLines) {
        throw new Error(
          `尾部窗口上限 ${maxLines} 行，无法取 ${limit} 行——建窗口时按最大消费方取值，或改上限（不静默少给）`
        );
      }
      return parseJsonlLines<T>(limit > 0 ? lines.slice(-limit) : [], policy);
    },
  };
}

/** 整读路径上的 head → tail 截断（顺序即既有语义：先截头再截尾） */
function applyHeadTail(lines: string[], options?: JsonlReadOptions): string[] {
  if (options?.head !== undefined) {
    lines = options.head > 0 ? lines.slice(0, options.head) : [];
  }
  if (options?.tail !== undefined) {
    lines = options.tail > 0 ? lines.slice(-options.tail) : [];
  }
  return lines;
}

export interface JsonlEndsResult<T> {
  /** 原始非空行数（合法 + 坏行），与 records.length + skippedLines 同口径 */
  totalLines: number;
  /** 自首向尾第一条合法记录；无合法记录为 undefined */
  first?: T;
  /** 自尾向首第一条合法记录；无合法记录为 undefined */
  last?: T;
}

/**
 * 只取首尾：首/末条合法记录 + 原始行数，parse 停在两端首个合法行
 *
 * 供只要「总数 + 首末记录」的调用点（如 TraceCollector.getStats）避免全量
 * parse；行文本仍整读（10MB 级文本读廉价，JSON.parse 才是成本）。坏行策略
 * 同 readJsonl：'skip' 跳过继续找，'throw' 遇坏行上抛。缺文件返回
 * { totalLines: 0 }。
 */
export function readJsonlEnds<T>(filePath: string, policy: JsonlBadLinePolicy): JsonlEndsResult<T> {
  const lines = readNonEmptyLines(filePath);

  let first: T | undefined;
  for (let i = 0; i < lines.length; i++) {
    try {
      first = JSON.parse(lines[i]) as T;
      break;
    } catch (error) {
      if (policy === 'throw') throw error;
    }
  }

  let last: T | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      last = JSON.parse(lines[i]) as T;
      break;
    } catch (error) {
      if (policy === 'throw') throw error;
    }
  }

  return { totalLines: lines.length, first, last };
}

/**
 * 追加一条 JSONL 记录：ensureDir + append（正本写链）
 *
 * 目录不存在时递归创建；value 序列化为单行 JSON + 换行。
 */
export function appendJsonl(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf-8');
}
