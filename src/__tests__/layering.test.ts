/**
 * 单向分层守卫（架构评审 2026-09-02 · 候选9 / harness#88；逐目录参数化 harness#137）
 *
 * 分层 `types → utils → core → 领域层 → cli` 此前只是文档约定。本文件把它落成三件事：
 * 1. 真扫描：**每个顶层单元（目录或 src 根文件）声明允许值导入的下行集合**，集合外的跨目录
 *    值 import 一律红。harness#88 时只守 `src/core/** ↛ cli/gates/monitoring` 一条边，
 *    types/utils 的回边与领域层互 import 全部放行；#137 改成逐目录冻结。
 * 2. 真规则：eslint.config.mjs 的 no-restricted-imports 对 core 上行值导入报 error，
 *    并允许 type-only（探针在纯 node 进程里跑仓内真配置，代码不落盘）。
 * 3. 反证：扫描器对合成 import 语句真报违例、指名到目录与边，且合法边不误报
 *    （不靠往 src 里塞临时文件——那是能被别的测试与 tsc 扫到的污染）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

interface LintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
}

/**
 * 探针脚本：在**纯 node** 里跑 FlatESLint（jest 的模块注册表拦截 flat config
 * 的 ESM 动态 import，需 --experimental-vm-modules；这里用真 node + 真配置文件）
 */
const LINT_PROBE_SCRIPT = `
const { FlatESLint } = require('eslint/use-at-your-own-risk');
const { code, filePath } = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
new FlatESLint({ cwd: process.cwd() })
  .lintText(code, { filePath })
  .then(r => process.stdout.write(JSON.stringify(r[0].messages)))
  .catch(e => { process.stderr.write(String(e && e.message)); process.exit(1); });
`;

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const SEP = path.sep;

/** 声明「可下行到任意单元」的记号，只给顶层组合面与测试面用 */
const ANY = '*';

/**
 * 每个顶层单元允许**值导入**的其他单元（目录名 / src 根文件名）。
 *
 * 口径：
 * - 只管跨目录的**值** import：type-only 一律放行（与 eslint 侧 allowTypeImports 同口径），
 *   同目录内的 import 也不管——本闸钉的是方向，不是模块粒度；
 * - 集合 = 该单元的分层位置允许的下行面 + **现状冻结**的同层边（逐条注理由）。
 *   新增一条跨目录边必须先在这里登记，diff 即评审材料；集合只多不减，
 *   还清一条债就把对应条目删掉，留着即虚账（登记闸只管活账）。
 */
const DOWNSTREAM: Record<string, string[]> = {
  // ── 叶子层 ──
  types: [], // 谁都能 import 它，它谁都不 import：回边即分层违例（#88 前无闸可跑）
  utils: ['types'],
  presets: ['types'], // 纯数据（CLAUDE.md），零内部依赖

  // ── core：数据/能力由调用方注入（harness#88）──
  // presets 属数据面，project-config-loader 合并 preset 不算上行
  core: ['presets', 'types', 'utils'],

  // ── 领域层：理想下行面 = core 以下；同层边逐条记名 ──
  agents: ['types', 'utils'],
  'completion-checkers': ['types', 'utils'], // 纯判定函数库，commits 由调用方供给
  failure: ['types', 'utils'],
  gates: ['core', 'types', 'utils'],
  knowledge: ['types', 'utils'],
  monitoring: ['types', 'utils'],
  release: [], // 「无内部依赖（只依赖 node fs/path）」= release/CONTEXT.md 的自我声明落成闸
  sdd: ['types', 'utils'],
  tools: ['types', 'utils'],
  // 同层互 import（现状冻结，不是许可）：context 注入取知识、SessionManager 取 trace 采集器。
  // 收口方向同 harness#88 对 core 的裁决——改注入，另票评估
  context: ['knowledge', 'monitoring', 'types', 'utils'],
  // bootstrapHarness 是本包组合根（装配 checker / SessionManager / TraceCollector），
  // monitoring 对它是下行而非债
  hooks: ['context', 'core', 'monitoring', 'types', 'utils'],

  // ── 测试夹具：被各目录的测试依赖，故排在它们之下 ──
  'test-setup': ['types', 'utils'],

  // ── 顶层组合面 / 测试面：可下行到任何单元 ──
  cli: [ANY], // CLI 是唯一的上层，per-command 懒加载各命令实现
  'index.ts': [ANY], // 包根 barrel（ADR-0003 显式清单）
  // 钩子入口：PreToolUse 决策取 CommandGate；P1-7（ADR-0031）命中留痕经
  // TraceCollector 写 traces——与 hooks 组合根 → monitoring 同方向，是下行不是债
  'pretool-use-hook.ts': ['gates', 'monitoring', 'types', 'utils'],
  __tests__: [ANY], // 根测试面：跨目录取生产码是本职
};

/**
 * 测试文件（目录段含 `__tests__`）在 `DOWNSTREAM` 之外额外放行的边。
 *
 * 单列而不并进目录集合，是因为并进去等于宣布生产面也有这条边：
 * - `'*'`：任何目录的测试都能用 test-setup 夹具；
 * - core 的测试回读包根 barrel，钉「公共面确实经 `src/index.ts` 导出」这条链
 *   （`agent-prompt-renderer` / `check-cache` 两处，ADR-0022 手法）；
 * - failure 的 recorder 测试顺带覆盖 CLI `failure list/stats`。
 */
const TEST_ONLY_EDGES: Record<string, string[]> = {
  '*': ['test-setup'],
  core: ['index.ts'],
  failure: ['cli'],
};

/** import / export-from / require / 动态 import 的源串 + 子句 */
const MODULE_SOURCE_REGEX =
  /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 去注释，避免文档里的示例 import 被当成真依赖 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `import type {X}` / `export type {X}` = type-only；混合 `import { type A, B }` 算值导入 */
function isTypeOnlyClause(clause: string): boolean {
  return /^\s*type(\s|\{|$)/.test(clause);
}

/** src 相对路径 → 顶层单元名（目录名，或 src 根文件名） */
function unitOf(relFromSrc: string): string {
  const sep = relFromSrc.indexOf(SEP);
  return sep === -1 ? relFromSrc : relFromSrc.slice(0, sep);
}

/** 一个 import 源串指向的单元；非相对路径（node/包名）与 src 之外返回 null */
function unitOfImport(fromFile: string, source: string): string | null {
  if (!source.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), source);
  const relToSrc = path.relative(SRC_DIR, resolved);
  if (!relToSrc || relToSrc.startsWith('..')) return null;
  const unit = unitOf(relToSrc);
  // src 根文件的 import 不带扩展名（`'../index'` → src/index.ts）：单元名按磁盘真名补回扩展，
  // 否则根文件单元在 import 侧叫 index、在登记侧叫 index.ts，两边对不上
  if (unit === relToSrc && fs.existsSync(path.join(SRC_DIR, `${unit}.ts`))) return `${unit}.ts`;
  return unit;
}

function isTestFile(relFromSrc: string): boolean {
  return `${SEP}${relFromSrc}${SEP}`.includes(`${SEP}__tests__${SEP}`);
}

interface Violation {
  unit: string;
  file: string;
  target: string;
  source: string;
}

/** 一个单元的允许集合（含测试放行与自身） */
function allowedTargetsFor(relFromSrc: string): Set<string> {
  const unit = unitOf(relFromSrc);
  const allowed = new Set(DOWNSTREAM[unit] ?? []);
  if (isTestFile(relFromSrc)) {
    for (const extra of TEST_ONLY_EDGES['*'] ?? []) allowed.add(extra);
    for (const extra of TEST_ONLY_EDGES[unit] ?? []) allowed.add(extra);
  }
  allowed.add(unit);
  return allowed;
}

/**
 * 扫一段代码里越界的跨目录值 import（纯函数：代码不来自磁盘，真扫描与反证共用一把尺）
 *
 * `relPath` 用于算自身单元，并出现在报错形状里（指名到文件与边）。
 */
function scanViolations(relPath: string, code: string): Violation[] {
  const unit = unitOf(relPath);
  const allowed = allowedTargetsFor(relPath);
  const absFile = path.join(SRC_DIR, relPath);

  const hits: Violation[] = [];
  MODULE_SOURCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MODULE_SOURCE_REGEX.exec(code)) !== null) {
    const clause = match[1] ?? '';
    const source = match[2] ?? match[3];
    if (match[1] && isTypeOnlyClause(clause)) continue;
    const target = unitOfImport(absFile, source);
    if (target === null || allowed.has(ANY) || allowed.has(target)) continue;
    hits.push({ unit, file: relPath, target, source });
  }
  return hits;
}

/** 在纯 node 子进程里用仓内真配置 lint 一段 core 侧探针代码，返回命中的方向规则 */
function probeCore(code: string, filePath = 'src/core/constraints/__layering_probe__.ts'): LintMessage[] {
  const out = execFileSync(process.execPath, ['-e', LINT_PROBE_SCRIPT], {
    cwd: REPO_ROOT,
    input: JSON.stringify({ code, filePath }),
    encoding: 'utf-8',
  });
  const messages = JSON.parse(out) as LintMessage[];
  return messages.filter(m => m.ruleId === '@typescript-eslint/no-restricted-imports');
}

/** src 下现存的顶层单元（目录 + 根 .ts 文件），供登记闸对撞 */
function currentUnits(): string[] {
  const units: string[] = [];
  for (const entry of fs.readdirSync(SRC_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) units.push(entry.name);
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      units.push(entry.name);
    }
  }
  return units;
}

describe('逐目录单向分层（harness#88 / #137）', () => {
  describe('登记闸：每个顶层单元都声明了下行集合', () => {
    it('src 下没有未登记的单元（新增目录先登记，不得绕过本闸）', () => {
      const unregistered = currentUnits().filter(unit => !(unit in DOWNSTREAM));
      expect(unregistered).toEqual([]);
    });

    it('登记的单元在 src 下真实存在（目录改名或删除后不留死账）', () => {
      const alive = new Set(currentUnits());
      const dead = Object.keys(DOWNSTREAM).filter(unit => !alive.has(unit));
      expect(dead).toEqual([]);
    });
  });

  describe('真扫描：每个文件的值 import 都落在声明过的下行集合内', () => {
    it.each(Object.keys(DOWNSTREAM))('%s 零越界值 import', unit => {
      const root = path.join(SRC_DIR, unit); // 目录或 src 根文件
      const files = fs.statSync(root).isDirectory() ? listTsFiles(root) : [root];
      const offenders = files
        .map(file =>
          scanViolations(path.relative(SRC_DIR, file), stripComments(fs.readFileSync(file, 'utf-8')))
        )
        .filter(hits => hits.length > 0);
      expect(offenders).toEqual([]);
    });
  });

  describe('反证：越界方向真被报出并指名到目录与边', () => {
    it.each([
      // [注入位置（src 相对）, 值 import 源串, 目录, 被禁目标]
      ['types/probe.ts', '../cli/commands/definitions', 'types', 'cli'],
      ['types/probe.ts', '../core/project-config-loader', 'types', 'core'],
      ['types/probe.ts', '../utils/jsonl', 'types', 'utils'],
      ['utils/probe.ts', '../core/constraints/checker', 'utils', 'core'],
      ['core/constraints/probe.ts', '../../monitoring/traces', 'core', 'monitoring'],
      ['core/constraints/probe.ts', '../../knowledge/store', 'core', 'knowledge'],
      ['core/constraints/probe.ts', '../../cli/commands/definitions', 'core', 'cli'],
      ['knowledge/probe.ts', '../context/session-manager', 'knowledge', 'context'],
      ['monitoring/probe.ts', '../gates/registry', 'monitoring', 'gates'],
      ['presets/probe.ts', '../core/constraints/definitions', 'presets', 'core'],
      ['release/probe.ts', '../core/effective-constraints', 'release', 'core'],
    ])('%s 值导入 %s 报违例（%s ↛ %s）', (rel, source, unit, target) => {
      const code = `import { something } from '${source}';\nexport const use = something;\n`;
      expect(scanViolations(rel, code)).toEqual([{ unit, file: rel, target, source }]);
    });

    it('报错形状带得出是哪条边（源串与文件都在内，不需人再 grep）', () => {
      // 行首动态 import（正则的另一支；行中 require 从来不在 MODULE_SOURCE_REGEX 覆盖面内）
      const [violation] = scanViolations(
        'types/probe.ts',
        `import('../cli/commands/check').then(m => m.check);\n`
      );
      expect(violation).toMatchObject({ unit: 'types', target: 'cli', source: '../cli/commands/check' });
    });

    it.each([
      ['core/constraints/probe.ts', `import type { GateDefinition } from '../../gates/definitions';`],
      ['types/probe.ts', `import type { RunEnv } from '../core/constraints/run-env';`],
      ['knowledge/probe.ts', `import { DEFAULT_DECAY_CONFIG } from './types';`],
      ['context/probe.ts', `import { KnowledgeQuery } from '../knowledge/query';`],
      ['hooks/probe.ts', `import { getTraceCollector } from '../monitoring/traces';`],
      ['core/probe.ts', `import { PRESETS_BY_NAME } from '../presets';`],
      ['failure/__tests__/probe.test.ts', `import { failureList } from '../../cli/commands/failure';`],
      ['core/constraints/__tests__/probe.test.ts', `import { checkConstraints } from '../../index';`],
      ['gates/__tests__/probe.test.ts', `import { createProjectFixture } from '../../test-setup/project-fixture';`],
      ['monitoring/probe.ts', `import * as fs from 'fs';`],
      ['monitoring/probe.ts', `const hint = 'src/gates/registry.ts';\nexport const h = hint;`],
    ])('合法边与噪声不误报：%s', (rel, statement) => {
      expect(scanViolations(rel, `${statement}\n`)).toEqual([]);
    });

    it('文档注释里的示例 import 不算依赖', () => {
      const code = `/** 用法：import { check } from '../../cli/commands/check'; */\nexport const x = 1;\n`;
      expect(scanViolations('core/constraints/probe.ts', code)).toEqual([]);
    });
  });

  describe('真规则：eslint 上行值导入报 error', () => {
    it.each([
      ['monitoring', '../../monitoring/traces'],
      ['cli', '../../cli/commands/definitions'],
      ['gates', '../../gates/definitions'],
    ])('core 值导入 %s 报 error（%s）', (_layer, source) => {
      const messages = probeCore(
        `import { something } from '${source}';\nexport const use = something;\n`
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].severity).toBe(2);
      expect(messages[0].message).toContain('harness#88');
    });

    it('type-only 上行导入放行', () => {
      const messages = probeCore(
        `import type { GateDefinition } from '../../gates/definitions';\nexport type Local = GateDefinition;\n`
      );
      expect(messages).toEqual([]);
    });

    it('同层/下层导入与上层目录名的字面量不误报', () => {
      const messages = probeCore(
        [
          `import { CheckCache } from './check-cache';`,
          `import type { ExecutionTrace } from '../../types/trace';`,
          `import * as fs from 'fs';`,
          `const gateDocs = 'src/gates/definitions.ts';`,
          `export const cache = new CheckCache({ ttlMs: 1 });`,
          `export const traceType: ExecutionTrace | null = null;`,
          `export const docs = gateDocs;`,
          `export const fsMod = fs;`,
        ].join('\n')
      );
      expect(messages).toEqual([]);
    });

    it('规则只作用于 src/core/**：cli 侧值导入 monitoring 不误报', () => {
      const messages = probeCore(
        `import { getTraceCollector } from '../../monitoring/traces';\nexport const c = getTraceCollector();\n`,
        'src/cli/commands/__layering_probe__.ts'
      );
      expect(messages).toEqual([]);
    });
  });
});
