/**
 * knowledge 子命令的投影出口（harness#133，架构评审候选4）
 *
 * 11 个子操作原先各自手写「json 投影 + 人读排版」两遍，同一个数据两处落地、字段名靠人
 * 对齐。本模块收口四件事，命令侧只留「取数 + 声明两投影」：
 *
 * - **display model**：结构化人读视图（sections / rows / cells）。命令给文字与排版，
 *   不给 ANSI；一格要么是纯文案（label），要么声明它投影自 json 面的哪个字段（field），
 *   要么声明是人读面独有的派生量（derived，须在测试的豁免表逐条登记理由）。
 * - **角色→样式单表 + 键→中文 label 映射**：维度 label、成熟度颜色、规则 label 的唯一权威。
 * - **json / 人读的唯一分派与退出码**：`--json` 打 `data` 的序列化，否则渲染 display model。
 * - **路径解析与 store 构造**：`-p` / `KNOWLEDGE_BASE_DIR` / 旧目录兜底只在这一处。
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileKnowledgeStore } from '../../knowledge/store';
import { AUDIT_RULE_LABELS } from '../../knowledge/audit-scoring';
import type { AuditIssue, AuditReport, AuditRuleName } from '../../knowledge/audit-scoring';
import type { MaturityLevel } from '../../knowledge/types';
import { log, logError, type CommandIO, type CommandResult } from '../command-contract';

// ── display model ─────────────────────────────────────────

/** 上色角色。具体颜色只在 TONE_STYLES 一张表里。 */
export type DisplayTone = 'heading' | 'accent' | 'emph' | 'muted' | 'ok' | 'warn' | 'error';

/** 纯文案格（标题、标点、缩进） */
export interface DisplayLabelCell {
  label: string;
  tone?: DisplayTone;
}

/** json 面字段的投影格：`field` 是点分路径（数组用下标，长度写 `.length`） */
export interface DisplayFieldCell {
  field: string;
  /** 呈现文本——可与 json 原值不同（百分号、`[verified]` 包壳、截断预览） */
  text: string;
  tone?: DisplayTone;
}

/** 人读面独有的派生量（json 面按现状冻结未暴露），须在豁免表登记理由 */
export interface DisplayDerivedCell {
  derived: string;
  text: string;
  tone?: DisplayTone;
}

export type DisplayCell = DisplayLabelCell | DisplayFieldCell | DisplayDerivedCell;

export interface DisplayRow {
  cells: DisplayCell[];
}

export interface DisplaySection {
  /** 小标题，渲染时统一 bold */
  title?: string;
  rows: DisplayRow[];
}

export interface DisplayModel {
  sections: DisplaySection[];
}

/** 一个空行（原排版里的 `\n` 前缀/后缀，在模型里是显式的一行） */
export function blankLine(): DisplayRow {
  return { cells: [{ label: '' }] };
}

/** 子操作的产物：json 面正本 + 惰性构建的人读面 */
export interface KnowledgeView<T = unknown> {
  data: T;
  human(): DisplayModel;
}

// ── 角色→样式与 label 映射的唯一权威 ───────────────────────

const TONE_STYLES: Record<DisplayTone, (text: string) => string> = {
  heading: chalk.blue,
  accent: chalk.cyan,
  emph: chalk.bold,
  muted: chalk.gray,
  ok: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
};

/** 审计维度中文 label（#109 编译期闭环：Record 全键标注随维度增删报错） */
const DIMENSION_LABELS: Record<keyof AuditReport['dimensions'], string> = {
  structure: 'D1 结构完整性',
  content: 'D2 内容质量',
  dedup: 'D3 去重有效性',
  maturity: 'D4 成熟度健康',
  freshness: 'D5 新鲜度',
  flywheel: 'D6 飞轮验证',
  incremental: 'D7 增量存活',
};

export function dimensionLabel(key: keyof AuditReport['dimensions']): string {
  return DIMENSION_LABELS[key];
}

/** 规则中文 label 正本在 audit.ts 的规则定义上，此处只转发 */
export function ruleLabel(rule: AuditRuleName): string {
  return AUDIT_RULE_LABELS[rule];
}

/** 审计条目的 severity 与 health 问题的 severity 共用一张角色表 */
export type SeverityName = AuditIssue['severity'] | 'error' | 'warn' | 'info';

const SEVERITY_TONES: Record<SeverityName, DisplayTone> = {
  critical: 'error',
  high: 'warn',
  medium: 'muted',
  low: 'muted',
  error: 'error',
  warn: 'warn',
  info: 'muted',
};

export function toneForSeverity(severity: SeverityName): DisplayTone {
  return SEVERITY_TONES[severity];
}

export function toneForMaturity(level: MaturityLevel): DisplayTone {
  return level === 'proven' ? 'ok'
    : level === 'verified' ? 'accent'
    : level === 'archived' ? 'muted'
    : 'warn';
}

/** 0-100 分的通用档位：≥80 绿、≥60 黄、其余红（audit 维度分与两处健康分同源） */
export function toneForScore(score: number): DisplayTone {
  return score >= 80 ? 'ok' : score >= 60 ? 'warn' : 'error';
}

// ── 分派与渲染 ────────────────────────────────────────────

function toneText(text: string, tone: DisplayTone): string {
  return TONE_STYLES[tone](text);
}

function cellText(cell: DisplayCell): string {
  const text = 'label' in cell ? cell.label : cell.text;
  return cell.tone ? toneText(text, cell.tone) : text;
}

/** 渲染 display model：一行一次写入，与逐行 console.log 等价 */
export function renderDisplayModel(io: CommandIO, model: DisplayModel): void {
  for (const section of model.sections) {
    if (section.title !== undefined) log(io, toneText(section.title, 'emph'));
    for (const row of section.rows) log(io, row.cells.map(cellText).join(''));
  }
}

/**
 * 取数过程中要打给用户的进度行（发生在两投影之前，`--json` 下一律静默）。
 * 分派条件只在这一处，命令侧不再各写 `if (options.json)`。
 */
export function announce(io: CommandIO, json: boolean | undefined, text: string, tone: DisplayTone = 'heading'): void {
  if (json) return;
  log(io, toneText(text, tone));
}

/** 子命令的唯一出口：json 面打 data 正本，人读面渲染 display model */
export function emitKnowledgeView<T>(io: CommandIO, options: { json?: boolean }, view: KnowledgeView<T>): CommandResult {
  if (options.json) {
    log(io, JSON.stringify(view.data, null, 2));
    return { kind: 'ok' };
  }
  renderDisplayModel(io, view.human());
  return { kind: 'ok' };
}

// ── 路径解析与 store 构造 ─────────────────────────────────

/** 缺省知识库数据根（相对用户 home） */
const KNOWLEDGE_DATA_DIR = path.join('.harness', 'knowledge');
/** 旧缺省数据根（曾寄居 studio home），仍有数据时兼容沿用，免迁移 */
const LEGACY_KNOWLEDGE_DATA_DIR = path.join('.studio', 'knowledge');

let legacyKnowledgeDirNotified = false;

function hasKnowledgeData(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

export interface KnowledgePathOptions {
  /** 覆盖知识库目录（audit/snapshot/migrate/index/health 收） */
  dir?: string;
  /** -p/--project-path */
  projectPath?: string;
}

/**
 * 知识库数据根的唯一解析点。`-p` 优先，其次 KNOWLEDGE_BASE_DIR，
 * 最后落到用户 home（旧目录仍有数据时沿用并只提示一次，提示走 stderr 不污染 --json）。
 */
export function resolveKnowledgeBaseDir(options: KnowledgePathOptions, io: CommandIO): string {
  if (options.dir) return options.dir;
  if (options.projectPath) return `${options.projectPath}/.harness/knowledge`;
  if (process.env.KNOWLEDGE_BASE_DIR) return process.env.KNOWLEDGE_BASE_DIR;
  const defaultDir = path.join(os.homedir(), KNOWLEDGE_DATA_DIR);
  const legacyDir = path.join(os.homedir(), LEGACY_KNOWLEDGE_DATA_DIR);
  if (hasKnowledgeData(legacyDir)) {
    if (!legacyKnowledgeDirNotified) {
      legacyKnowledgeDirNotified = true;
      logError(io, toneText(`⚠ 缺省知识库根已改为 ${defaultDir}；旧目录 ${legacyDir} 仍有数据，本次沿用（免迁移，可用 KNOWLEDGE_BASE_DIR 覆盖）`, 'warn'));
    }
    return legacyDir;
  }
  return defaultDir;
}

/** 知识库句柄的唯一构造点（路径解析全权交给 resolveKnowledgeBaseDir） */
export function openKnowledgeStore(options: KnowledgePathOptions, io: CommandIO): FileKnowledgeStore {
  return new FileKnowledgeStore({ baseDir: resolveKnowledgeBaseDir(options, io) });
}
