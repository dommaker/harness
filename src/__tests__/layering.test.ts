/**
 * 单向分层守卫（架构评审 2026-09-02 · 候选9 / harness#88）
 *
 * 分层 `types → utils → core → 领域层 → cli` 此前只是文档约定。本文件把它落成两件事：
 * 1. 真扫描：src/core/** 对 cli / gates / monitoring 零**值**导入（type-only 允许）
 * 2. 真规则：eslint.config.mjs 的 no-restricted-imports 对上行值导入报 error，
 *    并允许 type-only（探针在纯 node 进程里跑仓内真配置，代码不落盘）
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
const CORE_DIR = path.join(REPO_ROOT, 'src', 'core');
/** core 之下不得出现值导入的上层目录 */
const UPPER_LAYERS = ['cli', 'gates', 'monitoring'];

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

/** 收集一个文件里所有指向上层的值导入源串 */
function upwardValueImports(file: string): string[] {
  const text = stripComments(fs.readFileSync(file, 'utf-8'));
  const hits: string[] = [];
  MODULE_SOURCE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MODULE_SOURCE_REGEX.exec(text)) !== null) {
    const clause = match[1] ?? '';
    const source = match[2] ?? match[3];
    if (match[1] && isTypeOnlyClause(clause)) continue;
    if (!source.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), source);
    const relToSrc = path.relative(path.join(REPO_ROOT, 'src'), resolved);
    if (UPPER_LAYERS.some(layer => relToSrc === layer || relToSrc.startsWith(layer + path.sep))) {
      hits.push(source);
    }
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

describe('core 单向分层（harness#88）', () => {
  describe('真扫描：core/** 零上行值导入', () => {
    it('src/core 下每个文件对 cli/gates/monitoring 都没有值导入', () => {
      const offenders = listTsFiles(CORE_DIR)
        .map(file => ({ file: path.relative(REPO_ROOT, file), hits: upwardValueImports(file) }))
        .filter(entry => entry.hits.length > 0);

      expect(offenders).toEqual([]);
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
