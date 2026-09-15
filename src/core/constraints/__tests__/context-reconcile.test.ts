/**
 * context-reconcile 纯判定测试（harness#142 / ADR-0025）
 *
 * interface 即测试面（对位 ADR-0009）：喂 CONTEXT.md 正文 + 目录导出面清单，
 * 断言双向判定；零 fs fixture。夹具取仓内真实写法（hooks 的 `/` 连接多符号、
 * release 的节首散文 + 带参反引号、knowledge 的模块名 bullet、monitoring 的行首单符号）。
 */

import {
  reconcileContext,
  parseExportStatements,
  parseDeclaredExportSymbols,
} from '../context-reconcile';

const SECTION_HEAD = '## 核心导出\n';

function contextDoc(sectionBody: string, tailSection = '## 约定\n- 随便写点别的\n'): string {
  return `# 模块\n\n${SECTION_HEAD}${sectionBody}\n${tailSection}`;
}

describe('parseDeclaredExportSymbols — 「核心导出」节声明解析', () => {
  it('行首反引号标识符是声明；节外（其它 ## 节 / 节首散文）不算', () => {
    const doc = contextDoc(
      [
        '下列符号都由 `integrity.ts` 就地导出；散文段落里的 `NotADeclaration` 不参与。',
        '- `getCriticalArtifacts` — 公开 API',
        '- `EXTRA_CRITICAL_ARTIFACTS`——常量',
      ].join('\n')
    );
    expect(parseDeclaredExportSymbols(doc)).toEqual(['getCriticalArtifacts', 'EXTRA_CRITICAL_ARTIFACTS']);
  });

  it('`/` 连接的行首多符号逐个取（hooks 写法），并跳过括号形参（release 写法）', () => {
    const doc = contextDoc(
      [
        '- `bootstrapHarness` / `bootstrapHarnessSync` — 启动引导',
        '- `deriveCriticalArtifacts(manifest)`（`integrity.ts`）——纯函数',
        '- `getCriticalArtifacts(pkgRoot?)` / `verifyReleaseArtifacts(pkgRoot?)`——公开 API',
      ].join('\n')
    );
    expect(parseDeclaredExportSymbols(doc)).toEqual([
      'bootstrapHarness',
      'bootstrapHarnessSync',
      'deriveCriticalArtifacts',
      'getCriticalArtifacts',
      'verifyReleaseArtifacts',
    ]);
  });

  it('类型注解与模块名 bullet：`HookConfig`（type）取符号，`types.ts`/`audit-scoring`/`constraints/` 整条跳过', () => {
    const doc = contextDoc(
      [
        '- `HookConfig`（type）— per-hook 配置声明',
        '- `type HarnessBootstrap` — 把关键字写进反引号里的另一种类型注解形',
        '- `types.ts` — 类型定义文件',
        '- `audit-scoring`（包内，不进导出面）— 打分纯模块',
        '- `constraints/` — 子目录条目',
      ].join('\n')
    );
    expect(parseDeclaredExportSymbols(doc)).toEqual(['HookConfig', 'HarnessBootstrap']);
  });

  it('bullet 行首不是反引号（gates 的「统一协议：`Gate{…}`」形）不取声明；bullet 中段反引号不取', () => {
    const doc = contextDoc(
      [
        '- 统一协议：`Gate{id, order}` → `GateDecision{status}`（`types.ts`）',
        '- `TraceCollector` — 读入口 `readReport(filter?)` 与 `read()` 兼容包装',
      ].join('\n')
    );
    expect(parseDeclaredExportSymbols(doc)).toEqual(['TraceCollector']);
  });

  it('无「核心导出」节 → 空清单（散文式 CONTEXT.md 不参与内容判定）', () => {
    expect(parseDeclaredExportSymbols('# 模块\n\n## 职责\n- `Whatever`\n')).toEqual([]);
  });
});

describe('parseExportStatements — 源码导出面解析口径', () => {
  it('声明形：function/async function/const/class/interface/type/enum 各取符号并分型', () => {
    const src = [
      'export function f() {}',
      'export async function g() {}',
      'export const A = 1;',
      'export let B = 2;',
      'export class C {}',
      'export abstract class D {}',
      'export interface I {}',
      'export type T = string;',
      'export enum E {}',
      'const notExported = 0;',
    ].join('\n');
    const { symbols } = parseExportStatements(src);
    const asMap = Object.fromEntries(symbols.map((entry) => [entry.name, entry.typeOnly]));
    expect(asMap).toEqual({
      f: false,
      g: false,
      A: false,
      B: false,
      C: false,
      D: false,
      I: true,
      T: true,
      E: false,
    });
    expect(symbols.map((s) => s.name)).not.toContain('notExported');
  });

  it('`export { a, b as c }` 取导出名（别名后名），块级与逐项 `type` 标记都判为类型', () => {
    const src = [
      "export { Alpha, Beta as Gamma } from './alpha';",
      "export type { Delta } from './alpha';",
      "export { Epsilon, type Zeta } from './epsilon';",
    ].join('\n');
    const { symbols } = parseExportStatements(src);
    expect(symbols).toEqual([
      { name: 'Alpha', localName: 'Alpha', typeOnly: false, from: './alpha' },
      { name: 'Gamma', localName: 'Beta', typeOnly: false, from: './alpha' },
      { name: 'Delta', localName: 'Delta', typeOnly: true, from: './alpha' },
      { name: 'Epsilon', localName: 'Epsilon', typeOnly: false, from: './epsilon' },
      { name: 'Zeta', localName: 'Zeta', typeOnly: true, from: './epsilon' },
    ]);
  });

  it('列表里的空项与裸 `default` 说明符不成符号（尾逗号与整体默认导出不混为一谈）', () => {
    const src = ["export { Alpha, , default } from './x';", "export { Beta as default } from './y';"].join('\n');
    const { symbols } = parseExportStatements(src);
    expect(symbols).toEqual([
      { name: 'Alpha', localName: 'Alpha', typeOnly: false, from: './x' },
      { name: 'default', localName: 'Beta', typeOnly: false, from: './y' },
    ]);
  });

  it('`export *` 只报待解析的相对 spec；非相对 spec 由调用方跳过', () => {
    const src = ["export * from './types';", "export * as ns from './other';", "export * from 'chalk';"].join('\n');
    expect(parseExportStatements(src).starFrom).toEqual(['./types', './other', 'chalk']);
  });

  it('export default 记为 `default`；注释内的伪 export 不取', () => {
    const src = ['export default 42;', '// export const commented = 1;', '/* export const blocked = 2; */'].join('\n');
    const names = parseExportStatements(src).symbols.map((s) => s.name);
    expect(names).toEqual(['default']);
  });
});

describe('reconcileContext — 幽灵方向（文档→代码）', () => {
  const doc = contextDoc(['- `TraceCollector` — 收集', '- `ContextTracker` — 快照'].join('\n'));

  it('声明的符号在导出面中不存在 → 报幽灵并指名符号', () => {
    const v = reconcileContext({
      contextMdContent: doc,
      exportSurface: ['TraceCollector'],
    });
    expect(v.declaredSymbols).toEqual(['TraceCollector', 'ContextTracker']);
    expect(v.ghosts).toEqual(['ContextTracker']);
  });

  it('导出面含同名符号（含类型符号）→ 零幽灵', () => {
    expect(
      reconcileContext({
        contextMdContent: doc,
        exportSurface: ['TraceCollector', 'ContextTracker'],
      }).ghosts
    ).toEqual([]);
  });

  it('无「核心导出」节的文档不产幽灵，也不把 barrel 全量判成未登记', () => {
    const v = reconcileContext({
      contextMdContent: '# 模块\n\n只有散文\n',
      exportSurface: [],
      barrelExports: ['Anything'],
    });
    expect(v.hasCoreExportsSection).toBe(false);
    expect(v.ghosts).toEqual([]);
    expect(v.unlistedBarrelExports).toEqual([]);
  });
});

describe('reconcileContext — 覆盖方向（代码→文档，barrel 值符号）', () => {
  const doc = contextDoc(
    [
      '- `TraceCollector` — 执行追踪收集（`readReport(filter?)`）',
      '- `TraceAnalyzer` — 统计分析，另有 `createAnalyzer` 工厂',
    ].join('\n')
  );

  it('barrel 再导出的值符号未出现在「核心导出」节 → 未登记；inline 提及即算登记', () => {
    const v = reconcileContext({
      contextMdContent: doc,
      exportSurface: ['TraceCollector', 'TraceAnalyzer', 'createAnalyzer', 'configureTraceCollector'],
      barrelExports: ['TraceCollector', 'TraceAnalyzer', 'createAnalyzer', 'configureTraceCollector'],
    });
    expect(v.unlistedBarrelExports).toEqual(['configureTraceCollector']);
  });

  it('无 barrel 的目录（barrelExports 不传/空）跳过覆盖方向', () => {
    const v = reconcileContext({
      contextMdContent: contextDoc('- `COMMAND_DEFINITIONS` — 定义表'),
      exportSurface: ['COMMAND_DEFINITIONS', 'syncDocs'],
      barrelExports: [],
    });
    expect(v.unlistedBarrelExports).toEqual([]);
  });

  it('名称匹配按标识符边界：`Gate` 不因文档里有 `GateResult` 而算登记', () => {
    const v = reconcileContext({
      contextMdContent: contextDoc('- `GateResult` — 报告结构'),
      exportSurface: ['GateResult', 'Gate'],
      barrelExports: ['Gate', 'GateResult'],
    });
    expect(v.unlistedBarrelExports).toEqual(['Gate']);
  });

  it('节外正文（其它 ## 节）里的同名句子不救 barrel 未登记', () => {
    const v = reconcileContext({
      contextMdContent: contextDoc('- `TraceCollector` — 收集', '## 约定\n- `configureTraceCollector` 只在组合根用\n'),
      exportSurface: ['TraceCollector', 'configureTraceCollector'],
      barrelExports: ['TraceCollector', 'configureTraceCollector'],
    });
    expect(v.unlistedBarrelExports).toEqual(['configureTraceCollector']);
  });
});

describe('reconcileContext — 两方向同输入对撞', () => {
  it('改符号名（代码改名不回灌文档）同时撞出幽灵与未登记', () => {
    const doc = contextDoc('- `TraceCollector` — 收集\n');
    const v = reconcileContext({
      contextMdContent: doc,
      exportSurface: ['TraceSink', 'configureTraceCollector'],
      barrelExports: ['TraceSink'],
    });
    expect(v.ghosts).toEqual(['TraceCollector']);
    expect(v.unlistedBarrelExports).toEqual(['TraceSink']);
  });

  it('两侧一致 → 干净（判定不制造存量噪音）', () => {
    const doc = contextDoc('- `TraceCollector` — 收集\n- `configureTraceCollector` — 单例装配\n');
    const v = reconcileContext({
      contextMdContent: doc,
      exportSurface: ['TraceCollector', 'configureTraceCollector'],
      barrelExports: ['TraceCollector', 'configureTraceCollector'],
    });
    expect(v.ghosts).toEqual([]);
    expect(v.unlistedBarrelExports).toEqual([]);
    expect(v.hasCoreExportsSection).toBe(true);
  });
});
