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
 * tail / head：只解析尾部 / 头部 N 个非空行（文件仍全量读取，parse 才是大头），
 * 供「只看最近 K 条」的调用点避免全量 parse（check 等热路径）。
 * countJsonlLines 供纯计数消费方（完全不 parse）。
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
  /** 被跳过的坏行数（'throw' 策略下恒为 0） */
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

/**
 * 读取 JSONL 文件：exists → read → split → parse → filter（正本读链）
 *
 * policy 必填无缺省（裁决 1）；缺文件返回空结果，不抛。
 */
export function readJsonl<T>(
  filePath: string,
  policy: JsonlBadLinePolicy,
  options?: JsonlReadOptions
): JsonlReadResult<T> {
  let lines = readNonEmptyLines(filePath);
  if (options?.head !== undefined) {
    lines = options.head > 0 ? lines.slice(0, options.head) : [];
  }
  if (options?.tail !== undefined) {
    lines = options.tail > 0 ? lines.slice(-options.tail) : [];
  }

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
 * 统计非空行数（含坏行，完全不 parse）
 *
 * 供只关心记录条数的调用点（如 check 智能提示）避免全量 parse；
 * 缺文件返回 0。
 */
export function countJsonlLines(filePath: string): number {
  return readNonEmptyLines(filePath).length;
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
