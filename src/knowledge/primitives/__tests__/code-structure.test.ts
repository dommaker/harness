/**
 * extractCodeStructure — Layer 1 代码结构提取
 *
 * AC:
 * P5a-1: 从 .ts 文件提取函数/类/接口/类型声明
 * P5a-2: 从多文件目录提取，包含 import 依赖图
 * P5a-3: 空目录返回空结构
 * P5a-4: 非 .ts 文件忽略
 * P5a-5: JSDoc 注释关联到声明
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractCodeStructure } from '../code-structure';

// Use real fs for these tests (no mock) — testing actual TS parsing

describe('extractCodeStructure', () => {
  const tmpDir = path.join(__dirname, '__tmp__');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('P5a-1: extracts functions, classes, interfaces, types from .ts file', () => {
    const code = `
/** Helper function */
export function add(a: number, b: number): number { return a + b; }

/** A class */
export class Calculator {
  compute(x: number): number { return x * 2; }
}

export interface Config { debug: boolean; timeout: number; }

export type Result = { ok: boolean; data?: string };
`;
    fs.writeFileSync(path.join(tmpDir, 'math.ts'), code);

    const result = extractCodeStructure(tmpDir);

    expect(result.files).toContain('math.ts');
    expect(result.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'add' }),
      ]),
    );
    expect(result.classes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Calculator' }),
      ]),
    );
    expect(result.interfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Config' }),
      ]),
    );
    expect(result.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Result' }),
      ]),
    );
  });

  it('P5a-2: extracts imports and builds dependency graph', () => {
    const codeA = `import { add } from './math'; export const sum = add(1, 2);`;
    const codeB = `export function add(a: number, b: number): number { return a + b; }`;
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), codeA);
    fs.writeFileSync(path.join(tmpDir, 'math.ts'), codeB);

    const result = extractCodeStructure(tmpDir);

    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: './math' }),
      ]),
    );
  });

  it('P5a-3: empty directory returns empty structure', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);

    const result = extractCodeStructure(emptyDir);

    expect(result.files).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.classes).toEqual([]);
    expect(result.interfaces).toEqual([]);
    expect(result.types).toEqual([]);
  });

  it('P5a-4: non-.ts files are ignored', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello');
    fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'code.ts'), 'export const x = 1;');

    const result = extractCodeStructure(tmpDir);

    expect(result.files).toEqual(['code.ts']);
  });

  it('P5a-5: JSDoc comments are associated with declarations', () => {
    const code = `
/** Adds two numbers together */
export function add(a: number, b: number): number { return a + b; }
`;
    fs.writeFileSync(path.join(tmpDir, 'math.ts'), code);

    const result = extractCodeStructure(tmpDir);

    const fn = result.functions.find(f => f.name === 'add');
    expect(fn?.jsdoc).toContain('Adds two numbers');
  });
});
