/**
 * package.json 读取正本测试（重构 Phase 5 收口）
 *
 * 钉住两条语义：缺失 → null（合法输入）；在场但损坏 → 抛出（fail-fast）。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readPackageJson } from '../package-json';

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-package-json-'));
}

describe('readPackageJson', () => {
  it('package.json 缺失 → null', () => {
    expect(readPackageJson(makeDir())).toBeNull();
  });

  it('在场 → 解析出常见字段', () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        version: '1.2.3',
        scripts: { test: 'jest' },
        dependencies: { chalk: '^4.1.2' },
      })
    );

    const pkg = readPackageJson(dir);
    expect(pkg?.name).toBe('fixture');
    expect(pkg?.version).toBe('1.2.3');
    expect(pkg?.scripts?.test).toBe('jest');
    expect(pkg?.dependencies?.chalk).toBe('^4.1.2');
  });

  it('在场但 JSON 损坏 → 抛出（fail-fast，不装 null）', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');

    expect(() => readPackageJson(dir)).toThrow();
  });

  it('泛型窄化：消费方声明更窄的清单形状', () => {
    const dir = makeDir();
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'fixture', bin: { harness: './bin/harness.js' } })
    );

    const pkg = readPackageJson<{ name: string; bin: Record<string, string> }>(dir);
    expect(pkg?.bin.harness).toBe('./bin/harness.js');
  });
});
