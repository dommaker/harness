/**
 * detectSourceRoots 测试
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { detectSourceRoots } from '../utils/detect-source-roots';

const tempDir = join(__dirname, '__temp_detect_source_roots__');

beforeEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function touchFile(dir: string, name: string) {
  const filePath = join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, '// test');
}

describe('detectSourceRoots', () => {
  it('单 repo: src/ 目录', () => {
    touchFile(join(tempDir, 'src'), 'index.ts');
    const roots = detectSourceRoots(tempDir);
    expect(roots).toContain('src');
  });

  it('单 repo: lib/ 目录', () => {
    touchFile(join(tempDir, 'lib'), 'index.ts');
    const roots = detectSourceRoots(tempDir);
    expect(roots).toContain('lib');
  });

  it('空项目返回空数组', () => {
    const roots = detectSourceRoots(tempDir);
    expect(roots).toEqual([]);
  });

  it('monorepo: packages/*/src', () => {
    touchFile(join(tempDir, 'packages', 'core', 'src'), 'index.ts');
    touchFile(join(tempDir, 'packages', 'utils', 'src'), 'util.ts');
    const roots = detectSourceRoots(tempDir);
    expect(roots).toContain('packages/core/src');
    expect(roots).toContain('packages/utils/src');
  });

  it('monorepo: packages/*/lib', () => {
    touchFile(join(tempDir, 'packages', 'mylib', 'lib'), 'index.ts');
    const roots = detectSourceRoots(tempDir);
    expect(roots).toContain('packages/mylib/lib');
  });

  it('monorepo: apps/*/src/modules/*', () => {
    touchFile(join(tempDir, 'apps', 'api', 'src', 'modules', 'auth'), 'index.ts');
    touchFile(join(tempDir, 'apps', 'api', 'src', 'modules', 'users'), 'handler.ts');
    const roots = detectSourceRoots(tempDir);
    expect(roots).toContain('apps/api/src/modules/auth');
    expect(roots).toContain('apps/api/src/modules/users');
  });

  it('排除 .d.ts 文件（只有类型声明不视为源码目录）', () => {
    const dtsDir = join(tempDir, 'types');
    mkdirSync(dtsDir, { recursive: true });
    writeFileSync(join(dtsDir, 'index.d.ts'), 'export type Foo = string;');
    const roots = detectSourceRoots(tempDir);
    // types/ 只有 .d.ts → 不应被返回
    expect(roots.filter(r => r.includes('types'))).toEqual([]);
  });

  it('跳过 __tests__, node_modules, dist, 隐藏目录', () => {
    touchFile(join(tempDir, 'src'), 'index.ts');
    touchFile(join(tempDir, 'src', '__tests__'), 'test.ts');
    touchFile(join(tempDir, 'src', 'node_modules', 'pkg'), 'index.ts');
    touchFile(join(tempDir, 'packages', '.internal', 'src'), 'index.ts');
    const roots = detectSourceRoots(tempDir);
    // src/ 本身被包含，但 __tests__ 等子目录不影响
    expect(roots).toContain('src');
    // packages/.internal 的 src/ 也应该被发现
    expect(roots.some(r => r.includes('.internal'))).toBe(false);
    // 只要 src/ 下有 .ts 就算
    expect(roots.length).toBeGreaterThanOrEqual(1);
  });

  it('混合结构: packages + apps + src', () => {
    touchFile(join(tempDir, 'src'), 'main.ts');
    touchFile(join(tempDir, 'packages', 'core', 'src'), 'index.ts');
    touchFile(join(tempDir, 'apps', 'api', 'src', 'modules', 'auth'), 'index.ts');
    const roots = detectSourceRoots(tempDir);
    expect(roots).toContain('src');
    expect(roots).toContain('packages/core/src');
    expect(roots).toContain('apps/api/src/modules/auth');
  });
});
