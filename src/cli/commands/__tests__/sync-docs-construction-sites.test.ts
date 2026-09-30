/**
 * sync-docs 的构造点计数标记判定接线测试（harness#202 / ADR-0039）
 *
 * 钉四件事：
 * 1. 标记数字与实况不符时 `--check` 判 fail，reason 点名文件与类名；
 * 2. 无标记的散文陈述不判（现有文档不受影响）；
 * 3. 写入模式对计数漂移只提示、不改写 CONTEXT.md；
 * 4. `--json` 的 contentDrift 条目携带 constructionSites 明细。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { captureIO, type CapturingIO, type CommandResult } from '../../command-contract';
import { syncDocs } from '../sync-docs';

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
}));

function failReason(result: CommandResult): string {
  if (result.kind !== 'fail' && result.kind !== 'usage-error') {
    throw new Error(`期望 fail，实得 ${result.kind}`);
  }
  return result.reason;
}

let tempDir: string;
let io: CapturingIO;

const CLEAN_DOC = [
  '# mod/',
  '',
  '## 核心导出',
  '- `Widget` — 主体',
  '- `createWidget` — 工厂',
  '- `WIDGET_KIND` — 常量',
  '',
  '## 约定',
  '- 无',
  '',
].join('\n');

const BARREL = "export { Widget, createWidget, WIDGET_KIND } from './impl';\n";

/** impl.ts 里恰有一处 `new Widget()` 直构造 */
const IMPL = [
  'export class Widget {}',
  'export function createWidget() { return new Widget(); }',
  'export const WIDGET_KIND = "a";',
  '',
].join('\n');

/** 带标记的项目：marker 追加在「约定」节 */
function makeMarkedProject(name: string, marker: string): string {
  const projectPath = path.join(tempDir, name);
  const modDir = path.join(projectPath, 'src', 'mod');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'CAPABILITIES.md'),
    '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| all | src/ | 全量记录 |\n'
  );
  fs.writeFileSync(path.join(modDir, 'CONTEXT.md'), CLEAN_DOC + marker + '\n');
  fs.writeFileSync(path.join(modDir, 'index.ts'), BARREL);
  fs.writeFileSync(path.join(modDir, 'impl.ts'), IMPL);
  return projectPath;
}

beforeEach(() => {
  io = captureIO();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-sync-docs-sites-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('sync-docs — 构造点计数标记', () => {
  it('标记数字与实况一致 → ok', async () => {
    const projectPath = makeMarkedProject(
      'match',
      '<!-- sync-docs:construction-sites Widget = 1 -->'
    );
    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });

  it('标记数字与实况不符 → --check fail 并点名文件与类名', async () => {
    const projectPath = makeMarkedProject(
      'mismatch',
      '<!-- sync-docs:construction-sites Widget = 2 -->'
    );

    const result = await syncDocs({ projectPath, check: true }, io);

    expect(failReason(result)).toContain('src/mod/CONTEXT.md');
    expect(failReason(result)).toContain('Widget');
    expect(io.outText()).toContain('Widget');
  });

  it('无标记的构造点散文陈述不判', async () => {
    const projectPath = makeMarkedProject('prose', '- 仓内构造点两处（无标记，纯散文）');
    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });

  it('写入模式对计数漂移只提示、不改写 CONTEXT.md、退出码面不变', async () => {
    const projectPath = makeMarkedProject(
      'write-mode',
      '<!-- sync-docs:construction-sites Widget = 2 -->'
    );
    const contextPath = path.join(projectPath, 'src', 'mod', 'CONTEXT.md');
    const before = fs.readFileSync(contextPath, 'utf-8');

    const result = await syncDocs({ projectPath }, io);

    expect(result.kind).toBe('ok');
    expect(io.outText()).toContain('Widget');
    expect(fs.readFileSync(contextPath, 'utf-8')).toBe(before);
  });

  it('--json 的 contentDrift 条目携带 constructionSites 明细', async () => {
    const projectPath = makeMarkedProject(
      'json',
      '<!-- sync-docs:construction-sites Widget = 2 -->'
    );

    await syncDocs({ projectPath, check: true, json: true }, io);

    const payload = JSON.parse(io.outText());
    expect(payload.stale).toBe(true);
    expect(payload.contentDrift).toEqual([
      {
        dir: 'src/mod',
        file: 'src/mod/CONTEXT.md',
        ghosts: [],
        unlisted: [],
        constructionSites: [{ className: 'Widget', expected: 2, actual: 1, includeTests: false }],
      },
    ]);
  });

  it('默认口径不计测试目录；include: tests 计入', async () => {
    const projectPath = makeMarkedProject(
      'include-tests',
      '<!-- sync-docs:construction-sites Widget = 2 include: tests -->'
    );
    fs.mkdirSync(path.join(projectPath, 'src', 'mod', '__tests__'));
    fs.writeFileSync(
      path.join(projectPath, 'src', 'mod', '__tests__', 'w.test.ts'),
      'new Widget();\n'
    );

    // 带 include: tests 期望 2（impl + test）→ ok
    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });

  it('同一棵树不带 include 的标记只数到生产构造点', async () => {
    const projectPath = makeMarkedProject(
      'exclude-tests',
      '<!-- sync-docs:construction-sites Widget = 1 -->'
    );
    fs.mkdirSync(path.join(projectPath, 'src', 'mod', '__tests__'));
    fs.writeFileSync(
      path.join(projectPath, 'src', 'mod', '__tests__', 'w.test.ts'),
      'new Widget();\n'
    );

    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });
});
