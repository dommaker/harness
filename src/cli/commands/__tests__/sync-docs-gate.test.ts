/**
 * sync-docs --gate 测试（harness#189）
 *
 * 行为契约（票面锁定）：
 * 1. 照常先跑 sync-docs 自愈写入（幽灵条目剔除、file 模式自动补行不变）；
 * 2. 随后判定被管理文档相对 HEAD 是否产生 diff；
 * 3. 有 diff 即 fail，输出点名缺登记文件（diff 新增行即名单）；无 diff → ok。
 * 自愈顺序不变：写入永远在校验之前（2026-08-08 CI 4 连红固化结论）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { captureIO } from '../../command-contract';
import { syncDocs } from '../sync-docs';

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' });
}

function commitAll(dir: string, msg: string): void {
  git(dir, ['add', '-A']);
  git(dir, [
    '-c', 'user.name=test', '-c', 'user.email=test@example.com',
    'commit', '-m', msg, '--no-gpg-sign',
  ]);
}

/** 建最小 file 模式项目骨架（package.json + src/alpha.ts） */
function scaffoldProject(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'gate-fixture', version: '0.0.1' }));
  fs.writeFileSync(path.join(dir, 'src', 'alpha.ts'), '/**\n * Alpha module\n */\nexport const alpha = 1;');
}

describe('sync-docs --gate（harness#189）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-docs-gate-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /** 造一个 HEAD 文档干净的仓库：sync-docs 写入后提交 */
  async function setupCleanRepo(): Promise<void> {
    scaffoldProject(tempDir);
    git(tempDir, ['init']);
    await syncDocs({ projectPath: tempDir }, captureIO());
    commitAll(tempDir, 'baseline');
  }

  it('file 模式漏登 → fail 且点名缺登记文件，自愈写入已落盘（写入在校验之前）', async () => {
    await setupCleanRepo();

    // 造漏登：新增已提交但未登记的源文件（开发者忘了跑 sync-docs）
    fs.writeFileSync(path.join(tempDir, 'src', 'newmod.ts'), '/**\n * New module\n */\nexport const n = 1;');
    commitAll(tempDir, 'add newmod without registering');

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true }, io);

    expect(result.kind).toBe('fail');
    // 输出点名缺登记文件（diff 新增行即名单）
    expect(io.outText()).toContain('newmod');
    if (result.kind === 'fail') {
      expect(result.reason).toContain('newmod');
    }
    // 自愈顺序不变：判定失败时写入已落盘
    expect(fs.readFileSync(path.join(tempDir, 'CAPABILITIES.md'), 'utf-8')).toContain('newmod');
  });

  it('HEAD 文档干净（无需自愈）→ ok', async () => {
    await setupCleanRepo();

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true }, io);

    expect(result).toEqual({ kind: 'ok' });
  });

  it('幽灵条目剔除也触发门：写入在校验之前', async () => {
    await setupCleanRepo();

    // 造幽灵条目：CAPABILITIES.md 登记了不存在的 src/ghost.ts 并提交
    const capsPath = path.join(tempDir, 'CAPABILITIES.md');
    const content = fs.readFileSync(capsPath, 'utf-8');
    fs.writeFileSync(capsPath, content + '| ghost | src/ghost.ts | Ghost module |\n');
    commitAll(tempDir, 'register ghost entry');

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true }, io);

    expect(result.kind).toBe('fail');
    expect(io.outText()).toContain('ghost');
    // 自愈照做：幽灵行已被剔除
    expect(fs.readFileSync(capsPath, 'utf-8')).not.toContain('ghost');
  });

  it('sync-docs 查不出的未提交手改（描述改写）也是 vs HEAD 漂移 → fail', async () => {
    await setupCleanRepo();

    // 手改 CAPABILITIES.md 散文（不增删登记条目，sync-docs 判定面无漂移）且不提交
    const capsPath = path.join(tempDir, 'CAPABILITIES.md');
    const content = fs.readFileSync(capsPath, 'utf-8');
    fs.writeFileSync(capsPath, content.replace('Alpha module', 'Alpha module v2'));

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true }, io);

    expect(result.kind).toBe('fail');
    expect(io.outText()).toContain('CAPABILITIES.md');
  });

  it('--agents 时 AGENTS.md 漂移（untracked 新建）也判 fail 并点名', async () => {
    await setupCleanRepo();

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true, agents: true }, io);

    expect(result.kind).toBe('fail');
    expect(io.outText()).toContain('AGENTS.md');
  });

  it('非 git 仓库 → usage-error，且不做任何写入', async () => {
    scaffoldProject(tempDir);

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true }, io);

    expect(result.kind).toBe('usage-error');
    expect(fs.existsSync(path.join(tempDir, 'CAPABILITIES.md'))).toBe(false);
  });

  it.each([
    { extra: { check: true }, label: '--check' },
    { extra: { json: true }, label: '--json' },
    { extra: { compact: true }, label: '--compact' },
  ])('--gate 与 $label 互斥 → usage-error', async ({ extra }) => {
    await setupCleanRepo();

    const io = captureIO();
    const result = await syncDocs({ projectPath: tempDir, gate: true, ...extra }, io);

    expect(result.kind).toBe('usage-error');
  });
});
