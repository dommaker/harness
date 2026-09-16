/**
 * CONTEXT.md「核心导出」节与目录导出面的对照判定（harness#142 / ADR-0025）
 *
 * 纯判定 module：吃「CONTEXT.md 正文 + 目录导出面清单（+ barrel 值符号清单）」，
 * 一次产出双向判定；不做任何 fs IO——文件遍历、正文读取、`export *` 目标解析
 * 全在调用方（cli 侧），与 ADR-0009 的 capabilities-reconcile 同一套组装形状。
 *
 * 方向（语义与 capabilities-reconcile 对齐：幽灵 = 文档说谎，未登记 = 代码有而文档漏）：
 *   文档→代码  ghosts（「核心导出」节声明的符号在目录导出面里不存在）
 *   代码→文档  unlistedBarrelExports（index.ts 再导出的值符号未出现在该节）
 *
 * 口径（ADR-0025，两条都是「可操作」而非「越严越好」的取舍）：
 * - 声明只取 bullet **行首**的反引号标识符（`/` 连接的多符号逐个取，形参列表与
 *   `（type）`注解剥掉）。行首不是标识符的 bullet 是模块/目录条目
 *   （`types.ts`、`audit-scoring`、`constraints/`），不属符号声明面，整条跳过。
 * - 覆盖方向只管 barrel 的**值**符号：类型面（interface/type）不要求逐个登记
 *   ——否则每次加一个公开类型都要回灌文档，正是本闸要避免的「连注释都要改」。
 *   类型-only 的剔除在采集侧（读得懂 `export type { }` 与声明关键字的那一层）。
 * - 「出现在该节」按标识符边界匹配（inline 提及即算登记），bullet 行首之外的正文同样参与，
 *   但**其它 `## ` 节**的正文不参与——绕过闸需要把符号塞进「核心导出」节，而不是塞满全文件。
 */

/** markdown「## 核心导出」节标题（其后括注允许，如 `## 核心导出 (dist/)`） */
const SECTION_HEADING_REGEX = /^##\s*核心导出/;
/** 任意二级标题：节的终点（三级标题属节内子结构，不终止） */
const H2_HEADING_REGEX = /^##\s/;
/** bullet 行 */
const BULLET_REGEX = /^\s*[-*]\s*(.*)$/;
/** bullet 行首（及 `/` 连接的后续）反引号片段 */
const LEADING_BACKTICK_REGEX = /^`([^`]+)`/;
/** token 间的 `/` 分隔（可含空白）+ 下一个反引号起点 */
const NEXT_TOKEN_REGEX = /^(?:\s*\/\s*)?\s*`/;
/** 合法导出标识符 */
const IDENTIFIER_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** 源码导出声明：`export [默认] [形式] 名字` 与 `export { … } [from '…']` */
const DECLARATION_REGEX =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
/** `export { … }` / `export type { … }`（可带 from） */
const EXPORT_LIST_REGEX = /^export\s+(type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/gm;
/** `export * from '…'` / `export * as ns from '…'` */
const STAR_EXPORT_REGEX = /^export\s+\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\s*['"]([^'"]+)['"]/gm;

export interface ExportedSymbol {
  /** 导出名（`a as b` 取 b） */
  name: string;
  /** 来源侧的本名（`a as b` 取 a；自身声明与无别名再导出时等于 name）——调用方按它核对正本是否真有此物 */
  localName: string;
  /** 类型-only（interface/type 声明、`export type { }` 块、逐项 `type` 标记） */
  typeOnly: boolean;
  /** 再导出的来源 spec（`from './x'`），模块自身声明为 undefined */
  from?: string;
}

export interface ExportStatementParse {
  symbols: ExportedSymbol[];
  /** 待调用方解析的 `export *` 目标 spec（fs 侧才知道文件在不在） */
  starFrom: string[];
}

export interface ContextReconcileInput {
  /** CONTEXT.md 全文 */
  contextMdContent: string;
  /** 目录导出面全集：目录内所有 .ts 导出的符号名（值 + 类型，含 barrel 与内部 seam） */
  exportSurface: string[];
  /** index.ts barrel 再导出的**值**符号清单；无 index.ts 的目录不传（跳过覆盖方向） */
  barrelExports?: string[];
}

export interface ContextVerdict {
  /** 文档是否含「## 核心导出」节；无节 = 两方向都不参与判定 */
  hasCoreExportsSection: boolean;
  /** 该节解析出的符号声明（去重、按出现序） */
  declaredSymbols: string[];
  /** 幽灵：声明了但目录导出面没有 */
  ghosts: string[];
  /** 未登记：barrel 值符号未出现在该节 */
  unlistedBarrelExports: string[];
}

/**
 * 取「## 核心导出」节正文（不含标题行），到下一个二级标题为止。
 * 无该节 → null。
 */
export function parseCoreExportsSection(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION_HEADING_REGEX.test(line));
  if (start === -1) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (H2_HEADING_REGEX.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/** 反引号片段 → 导出符号名；剥形参列表与 `type` 关键字前缀，非标识符返回 null */
function toSymbolName(token: string): string | null {
  const bare = token.replace(/[（(].*$/, '').trim();
  const withoutKeyword = /^type\s+/.test(bare) ? bare.replace(/^type\s+/, '').trim() : bare;
  return IDENTIFIER_REGEX.test(withoutKeyword) ? withoutKeyword : null;
}

/**
 * 解析「## 核心导出」节的符号声明：只认 bullet 行首的反引号标识符
 * （`/` 连接视为多个声明，其后的散文与 inline 提及不参与幽灵判定）。
 */
export function parseDeclaredExportSymbols(content: string): string[] {
  const section = parseCoreExportsSection(content);
  if (section === null) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    const bullet = BULLET_REGEX.exec(line);
    if (!bullet) continue;

    let rest = bullet[1];
    for (;;) {
      const token = LEADING_BACKTICK_REGEX.exec(rest);
      if (!token) break;
      const name = toSymbolName(token[1]);
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
      rest = rest.slice(token[0].length);
      const separator = NEXT_TOKEN_REGEX.exec(rest);
      if (!separator) break;
      rest = rest.slice(separator[0].length - 1);
    }
  }
  return out;
}

/**
 * 解析单个源文件的导出面（口径正本，采集侧与测试共用）：
 * 声明形、`export { }` 列表形（含别名与逐项 `type`）、`export default`、`export *`。
 * 只做正则解析，不解析 spec 指向谁——那是调用方的 fs 活。
 */
export function parseExportStatements(source: string): ExportStatementParse {
  const symbols: ExportedSymbol[] = [];

  for (const match of source.matchAll(DECLARATION_REGEX)) {
    symbols.push({
      name: match[2],
      localName: match[2],
      typeOnly: match[1] === 'interface' || match[1] === 'type',
    });
  }

  for (const match of source.matchAll(EXPORT_LIST_REGEX)) {
    const blockIsType = Boolean(match[1]);
    const from = match[3];
    for (const part of match[2].split(',')) {
      const specifier = part.trim();
      if (!specifier || specifier === 'default') continue;
      const typeOnly = blockIsType || /^type\s+/.test(specifier);
      const cleaned = specifier.replace(/^type\s+/, '').trim();
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(cleaned);
      const single = /^([A-Za-z_$][\w$]*)$/.exec(cleaned);
      if (aliased) symbols.push({ name: aliased[2], localName: aliased[1], typeOnly, ...(from ? { from } : {}) });
      else if (single) symbols.push({ name: single[1], localName: single[1], typeOnly, ...(from ? { from } : {}) });
    }
  }

  if (/^export\s+default\b/m.test(source)) {
    symbols.push({ name: 'default', localName: 'default', typeOnly: false });
  }

  return {
    symbols,
    starFrom: [...source.matchAll(STAR_EXPORT_REGEX)].map((m) => m[1]),
  };
}

/** 符号是否在该节正文中出现（标识符边界匹配） */
function mentionedInSection(section: string, symbol: string): boolean {
  const escaped = symbol.replace(/[$]/g, '\\$');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(section);
}

/**
 * CONTEXT.md 与目录导出面的双向判定（唯一真相源，sync-docs 与任何后续消费方共用）。
 */
export function reconcileContext(input: ContextReconcileInput): ContextVerdict {
  const section = parseCoreExportsSection(input.contextMdContent);
  const hasCoreExportsSection = section !== null && section.trim() !== '';
  const declaredSymbols = parseDeclaredExportSymbols(input.contextMdContent);
  const surface = new Set(input.exportSurface);
  const ghosts = declaredSymbols.filter((symbol) => !surface.has(symbol));

  const barrelExports = [...new Set(input.barrelExports ?? [])];
  const unlistedBarrelExports = hasCoreExportsSection
    ? barrelExports.filter((symbol) => !mentionedInSection(section as string, symbol))
    : [];

  return { hasCoreExportsSection, declaredSymbols, ghosts, unlistedBarrelExports };
}
