/**
 * file-walk 工具测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findTsSourceFiles, walkFiles, walkMatches } from '../file-walk';

describe('walkMatches', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-walk-matches-'));
    fs.mkdirSync(path.join(tempDir, 'docs/a'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'node_modules/pkg'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs/top.md'), '');
    fs.writeFileSync(path.join(tempDir, 'docs/a/x.md'), '');
    fs.writeFileSync(path.join(tempDir, 'docs/a/x.ts'), '');
    fs.writeFileSync(path.join(tempDir, 'node_modules/pkg/y.md'), '');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('返回匹配 glob 的相对路径集（正斜杠口径）', () => {
    expect(walkMatches(tempDir, 'docs/**/*.md').sort()).toEqual(['docs/a/x.md', 'docs/top.md']);
    expect(walkMatches(tempDir, 'docs/*')).toEqual(['docs/top.md']);
  });

  it('skipDirs 跳过的目录不参与匹配', () => {
    expect(walkMatches(tempDir, '**/*.md', { skipDirs: ['node_modules'] }).sort())
      .toEqual(['docs/a/x.md', 'docs/top.md']);
  });

  it('includeDirs 时目录也算命中', () => {
    expect(walkMatches(tempDir, 'docs/*', { includeDirs: true }).sort())
      .toEqual(['docs/a', 'docs/top.md']);
  });
});

describe('walkFiles', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-walk-files-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makeTree(name: string): string {
    const dir = path.join(tempDir, name);
    fs.mkdirSync(path.join(dir, 'docs/a'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'empty'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'top.md'), '');
    fs.writeFileSync(path.join(dir, 'docs/a/x.md'), '');
    return dir;
  }

  it('默认只收集文件（含空目录在内的目录不进结果）', () => {
    const dir = makeTree('files-only');

    const rel = walkFiles(dir).map(f => path.relative(dir, f)).sort();
    expect(rel).toEqual(['docs/a/x.md', 'top.md']);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('includeDirs: true 时目录与文件都收集', () => {
    const dir = makeTree('with-dirs');

    const rel = walkFiles(dir, { includeDirs: true }).map(f => path.relative(dir, f)).sort();
    expect(rel).toEqual(['docs', 'docs/a', 'docs/a/x.md', 'empty', 'top.md']);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('includeDirs 与 skipDirs 组合：跳过目录不收也不下钻', () => {
    const dir = makeTree('skip-with-dirs');

    const rel = walkFiles(dir, { includeDirs: true, skipDirs: ['docs'] })
      .map(f => path.relative(dir, f))
      .sort();
    expect(rel).toEqual(['empty', 'top.md']);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('includeDirs 时 filter 对目录与文件同口径生效', () => {
    const dir = makeTree('filter-with-dirs');

    const rel = walkFiles(dir, {
      includeDirs: true,
      filter: (name) => name.endsWith('.md') || name === 'docs',
    })
      .map(f => path.relative(dir, f))
      .sort();
    expect(rel).toEqual(['docs', 'docs/a/x.md', 'top.md']);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('findTsSourceFiles', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-file-walk-'));
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
