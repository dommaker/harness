/**
 * CONTEXT.md 内容判定采集侧测试（harness#142）
 *
 * 采集 = fs 遍历 + 导出口径（`export *` 解析、barrel 再导出的类型-only 剔除）。
 * 判定本体在 core/constraints/context-reconcile（旁测见 context-reconcile.test.ts）。
 * 与 sync-docs 其余测试同法：临时目录真 fs，零注入。
 */

import * as fs from 'fs';
import * as path from 'path';
import { collectContextExportSurface } from '../context-syncer';

const tempDir = path.join(process.cwd(), 'temp-test-context-surface');

function write(rel: string, content: string): void {
  const target = path.join(tempDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

beforeAll(() => {
  fs.mkdirSync(tempDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('collectContextExportSurface — 目录导出面采集', () => {
  it('收集目录内（含子目录）.ts 的导出符号；__tests__ 与 .d.ts 不参与', async () => {
    const dir = 'mod-scan';
    write(`${dir}/core.ts`, 'export function doCore() {}\nexport interface CoreConfig {}\n');
    write(`${dir}/nested/deep.ts`, 'export const DEEP_VALUE = 1;');
    write(`${dir}/__tests__/core.test.ts`, 'export const TEST_ONLY_HELPER = 2;');
    write(`${dir}/ambient.d.ts`, 'export const GLOBAL_FROM_DTS = 3;');

    const { surface, barrelExports } = await collectContextExportSurface(path.join(tempDir, dir), tempDir);

    expect(surface).toEqual(expect.arrayContaining(['doCore', 'CoreConfig', 'DEEP_VALUE']));
    expect(surface).not.toContain('TEST_ONLY_HELPER');
    expect(surface).not.toContain('GLOBAL_FROM_DTS');
    // 无 index.ts → barrel 方向空转
    expect(barrelExports).toEqual([]);
  });

  it('barrel 只交值符号：export type 块、逐项 type、别名取导出名', async () => {
    const dir = 'mod-barrel';
    write(`${dir}/impl.ts`, 'export class Widget {}\nexport interface WidgetConfig {}\nexport const WIDGET_LIMIT = 1;\n');
    write(
      `${dir}/index.ts`,
      [
        "export { Widget, WIDGET_LIMIT as LIMIT } from './impl';",
        "export type { WidgetConfig } from './impl';",
        "export { createThing, type ThingShape } from './thing';",
        'export function barrelLocal() {}',
      ].join('\n')
    );
    write(`${dir}/thing.ts`, 'export function createThing() {}\nexport type ThingShape = string;');

    const { surface, barrelExports } = await collectContextExportSurface(path.join(tempDir, dir), tempDir);

    expect(barrelExports.sort()).toEqual(['LIMIT', 'Widget', 'barrelLocal', 'createThing']);
    expect(surface).toEqual(expect.arrayContaining(['WidgetConfig', 'ThingShape']));
  });

  it('`export *` 在同目录内解析目标后并入（值进 barrel、类型不进）', async () => {
    const dir = 'mod-star';
    write(`${dir}/types.ts`, 'export interface Shape {}\nexport type Mode = "a" | "b";\nexport enum Kind { A }\n');
    write(`${dir}/store.ts`, 'export class Store {}\nexport const DEFAULTS = {};\n');
    write(`${dir}/index.ts`, ["export * from './types';", "export * from './store';", "export * from 'chalk';"].join('\n'));

    const { surface, barrelExports } = await collectContextExportSurface(path.join(tempDir, dir), tempDir);

    expect(barrelExports.sort()).toEqual(['DEFAULTS', 'Kind', 'Store']);
    expect(surface).toEqual(expect.arrayContaining(['Shape', 'Mode', 'Kind', 'Store', 'DEFAULTS']));
  });

  it('跨目录再导出的类型按正本声明分型（值侧要求登记，类型侧豁免）', async () => {
    write('types/external.ts', 'export const EXTERNAL_VALUE = 1;\nexport interface ExternalShape {}\n');
    const dir = 'mod-cross';
    write(
      `${dir}/index.ts`,
      ["export { EXTERNAL_VALUE, ExternalShape } from '../types/external';", 'export const Own = 2;'].join('\n')
    );

    const { barrelExports } = await collectContextExportSurface(path.join(tempDir, dir), tempDir);

    expect(barrelExports.sort()).toEqual(['EXTERNAL_VALUE', 'Own']);
  });

  it('barrel 再导出正本已不存在的名字 → 不计入导出面（改名的虚 barrel 不洗白幽灵）', async () => {
    const dir = 'mod-phantom';
    write(`${dir}/impl.ts`, 'export class WidgetSink {}\nexport interface Shape {}\n');
    write(`${dir}/index.ts`, "export { Widget, WidgetSink } from './impl';\nexport type { Missing } from './impl';");

    const { surface, barrelExports } = await collectContextExportSurface(path.join(tempDir, dir), tempDir);

    expect(surface).toEqual(['WidgetSink', 'Shape']);
    expect(barrelExports).toEqual(['WidgetSink']);
  });
});
