/**
 * 构造点计数采集测试（harness#202 / ADR-0039）
 *
 * 钉计数口径：全仓 `new X(` 直构造，默认排除 DEFAULT_SKIP_DIRS
 * （node_modules/__tests__/dist），标记带 include: tests 时把测试目录计入。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createConstructionSiteCounter } from '../context-syncer';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-construction-count-'));
  fs.mkdirSync(path.join(tempDir, 'src', '__tests__'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, 'src', 'a.ts'),
    'const x = new Widget();\nconst y = new Widget({});\nconst z = new Map<string, boolean>();\n'
  );
  fs.writeFileSync(path.join(tempDir, 'src', '__tests__', 'a.test.ts'), 'new Widget();\n');
  fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'x.ts'), 'new Widget();\n');
  fs.writeFileSync(path.join(tempDir, 'dist', 'out.ts'), 'new Widget();\n');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('createConstructionSiteCounter', () => {
  it('默认口径排除 __tests__/node_modules/dist', () => {
    const count = createConstructionSiteCounter(tempDir);
    expect(count('Widget', false)).toBe(2);
    expect(count('Map', false)).toBe(1);
  });

  it('includeTests 口径把测试目录计入', () => {
    const count = createConstructionSiteCounter(tempDir);
    expect(count('Widget', true)).toBe(3);
  });

  it('未出现的类名计 0', () => {
    const count = createConstructionSiteCounter(tempDir);
    expect(count('Missing', false)).toBe(0);
  });
});
