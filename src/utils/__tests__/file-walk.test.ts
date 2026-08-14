/**
 * file-walk 工具测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { findTsSourceFiles } from '../file-walk';

describe('findTsSourceFiles', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-file-walk');

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('默认只收集 .ts（排除 .d.ts），.tsx 不进入结果', () => {
    const dir = path.join(tempDir, 'default-ts-only');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.ts'), '');
    fs.writeFileSync(path.join(dir, 'b.d.ts'), '');
    fs.writeFileSync(path.join(dir, 'c.tsx'), '');

    const names = findTsSourceFiles(dir).map(f => path.basename(f)).sort();
    expect(names).toEqual(['a.ts']);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('includeTsx: true 时同时收集 .tsx，skipIndex 排除 index.ts/index.tsx', () => {
    const dir = path.join(tempDir, 'include-tsx');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.ts'), '');
    fs.writeFileSync(path.join(dir, 'b.d.ts'), '');
    fs.writeFileSync(path.join(dir, 'c.tsx'), '');
    fs.writeFileSync(path.join(dir, 'index.ts'), '');
    fs.writeFileSync(path.join(dir, 'index.tsx'), '');

    const names = findTsSourceFiles(dir, { includeTsx: true, skipIndex: true })
      .map(f => path.basename(f))
      .sort();
    expect(names).toEqual(['a.ts', 'c.tsx']);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
