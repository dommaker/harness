/**
 * sync-docs 的 CONTEXT.md 内容漂移判定接线测试（harness#142）
 *
 * 钉四件事：
 * 1. 内容漂移（幽灵 / barrel 未登记）在 `--check` 下判 fail，reason 点名文件与符号；
 * 2. mtime 漂移降级为本地提示——不再影响退出码，且 CI 环境下连提示都抑制；
 * 3. `--json` 有 contentDrift 结构（供 LLM/CI 消费）；
 * 4. 写入模式不改写 CONTEXT.md（散文不可机械生成），退出码面不变。
 */

import * as fs from 'fs';
import * as path from 'path';
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

/** 取 fail 的 reason（判别联合窄化只在测试里做一次） */
function failReason(result: CommandResult): string {
  if (result.kind !== 'fail' && result.kind !== 'usage-error') {
    throw new Error(`期望 fail，实得 ${result.kind}`);
  }
  return result.reason;
}

const tempDir = path.join(process.cwd(), 'temp-test-sync-docs-drift');
const CI = process.env.CI;

let io: CapturingIO;

/** 建一个「CAPABILITIES 已覆盖 src/」的最小项目，把漂移轴隔离到 CONTEXT.md */
function makeProject(name: string, contextMd: string, indexTs: string): string {
  const projectPath = path.join(tempDir, name);
  const modDir = path.join(projectPath, 'src', 'mod');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'CAPABILITIES.md'),
    '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| all | src/ | 全量记录 |\n'
  );
  fs.writeFileSync(path.join(modDir, 'CONTEXT.md'), contextMd);
  fs.writeFileSync(path.join(modDir, 'index.ts'), indexTs);
  fs.writeFileSync(
    path.join(modDir, 'impl.ts'),
    'export class Widget {}\nexport function createWidget() {}\nexport const WIDGET_KIND = "a";\n'
  );
  return projectPath;
}

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

const BARREL = [
  "export { Widget, createWidget, WIDGET_KIND } from './impl';",
  "export type { WidgetConfig } from './impl';",
].join('\n');

beforeEach(() => {
  io = captureIO();
  fs.mkdirSync(tempDir, { recursive: true });
  delete process.env.CI;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (CI === undefined) delete process.env.CI;
  else process.env.CI = CI;
});

describe('sync-docs — CONTEXT.md 内容漂移判 fail（--check）', () => {
  it('文档与导出面一致 → ok（新闸不制造存量噪音）', async () => {
    const projectPath = makeProject('clean', CLEAN_DOC, BARREL);
    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });

  it('幽灵符号（代码改名不回灌文档）→ fail 并指名文件与符号', async () => {
    const projectPath = makeProject(
      'ghost',
      CLEAN_DOC.replace('`Widget`', '`WidgetRenamed`'),
      BARREL
    );

    const result = await syncDocs({ projectPath, check: true }, io);

    expect(failReason(result)).toContain('src/mod/CONTEXT.md');
    expect(failReason(result)).toContain('WidgetRenamed');
    expect(io.outText()).toContain('WidgetRenamed');
  });

  it('barrel 未跟着改名的虚再导出不洗白幽灵（正本改名即撞）', async () => {
    const projectPath = makeProject('ghost-barrel', CLEAN_DOC, BARREL);
    // 只改声明侧（Widget → WidgetSink），index.ts 的再导出与文档都不动
    fs.writeFileSync(
      path.join(projectPath, 'src', 'mod', 'impl.ts'),
      'export class WidgetSink {}\nexport function createWidget() {}\nexport const WIDGET_KIND = "a";\n'
    );

    const result = await syncDocs({ projectPath, check: true }, io);

    expect(failReason(result)).toContain('src/mod/CONTEXT.md');
    expect(failReason(result)).toContain('Widget');
  });

  it('barrel 新增值符号未登记 → fail 并指名该符号', async () => {
    const projectPath = makeProject(
      'unlisted',
      CLEAN_DOC.replace('- `WIDGET_KIND` — 常量\n', ''),
      BARREL
    );

    const result = await syncDocs({ projectPath, check: true }, io);

    expect(failReason(result)).toContain('src/mod/CONTEXT.md');
    expect(failReason(result)).toContain('WIDGET_KIND');
  });

  it('barrel 新增类型符号 → 不要求登记（类型面豁免）', async () => {
    const projectPath = makeProject(
      'type-only',
      CLEAN_DOC,
      [BARREL, "export { type ExtraShape } from './impl';"].join('\n')
    );

    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });

  it('无 index.ts 的目录跳过覆盖方向（内部导出不要求登记）', async () => {
    const projectPath = makeProject('no-barrel', CLEAN_DOC, BARREL);
    fs.rmSync(path.join(projectPath, 'src', 'mod', 'index.ts'));

    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
  });
});

describe('sync-docs — mtime 判定降级为提示', () => {
  /** 只把源码时间戳推到 CONTEXT.md 之后，内容一字不改 */
  function touchSourceLater(projectPath: string): void {
    const contextPath = path.join(projectPath, 'src', 'mod', 'CONTEXT.md');
    const contextMtime = new Date(Date.now() - 60_000);
    fs.utimesSync(contextPath, contextMtime, contextMtime);
    const impl = path.join(projectPath, 'src', 'mod', 'impl.ts');
    const later = new Date();
    fs.utimesSync(impl, later, later);
  }

  it('mtime 漂移不再判 fail，只在本地给提示', async () => {
    const projectPath = makeProject('mtime', CLEAN_DOC, BARREL);
    touchSourceLater(projectPath);

    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
    expect(io.outText()).toContain('源码比文档新');
  });

  it('CI 环境下 mtime 提示抑制（全新 checkout 的 mtime 无意义）', async () => {
    const projectPath = makeProject('mtime-ci', CLEAN_DOC, BARREL);
    touchSourceLater(projectPath);
    process.env.CI = 'true';

    await expect(syncDocs({ projectPath, check: true }, io)).resolves.toEqual({ kind: 'ok' });
    expect(io.outText()).not.toContain('源码比文档新');
  });

  it('内容漂移在 CI 环境下照样 fail', async () => {
    const projectPath = makeProject('content-ci', CLEAN_DOC.replace('`Widget`', '`Gone`'), BARREL);
    process.env.CI = 'true';

    const result = await syncDocs({ projectPath, check: true }, io);
    expect(failReason(result)).toContain('Gone');
  });
});

describe('sync-docs — --json 与写入模式', () => {
  it('--json 输出 contentDrift（dir/file/ghosts/unlisted）', async () => {
    const projectPath = makeProject(
      'json',
      CLEAN_DOC.replace('- `WIDGET_KIND` — 常量\n', '').replace('`Widget`', '`Ghost`'),
      BARREL
    );

    await syncDocs({ projectPath, check: true, json: true }, io);

    const payload = JSON.parse(io.outText());
    expect(payload.stale).toBe(true);
    expect(payload.summary.contextContentDrift).toBe(1);
    expect(payload.contentDrift).toEqual([
      {
        dir: 'src/mod',
        file: 'src/mod/CONTEXT.md',
        ghosts: ['Ghost'],
        unlisted: ['Widget', 'WIDGET_KIND'],
      },
    ]);
  });

  it('--json 干净时 contentDrift 为空数组', async () => {
    const projectPath = makeProject('json-clean', CLEAN_DOC, BARREL);

    await syncDocs({ projectPath, check: true, json: true }, io);

    expect(JSON.parse(io.outText()).contentDrift).toEqual([]);
  });

  it('写入模式给提示但不改 CONTEXT.md、退出码面不变', async () => {
    const projectPath = makeProject('write', CLEAN_DOC.replace('`Widget`', '`Ghost`'), BARREL);
    const contextPath = path.join(projectPath, 'src', 'mod', 'CONTEXT.md');
    const before = fs.readFileSync(contextPath, 'utf-8');

    const result = await syncDocs({ projectPath }, io);

    expect(result.kind).toBe('ok');
    expect(io.outText()).toContain('Ghost');
    expect(fs.readFileSync(contextPath, 'utf-8')).toBe(before);
  });
});
