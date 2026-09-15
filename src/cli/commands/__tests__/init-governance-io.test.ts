/**
 * 治理链路的 io 注入不逃逸（harness#149）
 *
 * setupGovernance 手握 io，却在两个调用点把它丢了（`setupClaudeMdOutputStyle(projectPath)`
 * / `setupGovernanceConstraints(projectPath)`），被调方一律 `io: CommandIO = processIO`
 * 兜成真实 stdout。真机输出正常，但注入面的测试看不见那 14 条提示——`⚠️ …标记残缺…`
 * 这类唯一提示写坏了没有测试会红。
 *
 * 本文件不 mock 任何 IO：在临时目录里真跑 init，断言治理段提示落在**注入面**。
 * 改造前这些断言逐条为红（文本逃到了 process.stdout）。
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { init, type InitOptions } from '../init';
import { captureIO, type CapturingIO } from '../../command-contract';

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
}));

const INIT_SOURCE = fsSync.readFileSync(path.join(__dirname, '..', 'init.ts'), 'utf-8');

const INIT_OPTIONS: Partial<InitOptions> = { preset: 'standard', governance: 'standard' };

/** 真临时工程根：带 .git 与 src/，让 init 走完治理链路而不必先落别的文件 */
async function makeProject(files: Record<string, string> = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-governance-io-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  await fs.mkdir(path.join(root, '.git'));
  for (const [rel, content] of Object.entries(files)) {
    await fs.writeFile(path.join(root, rel), content, 'utf-8');
  }
  return root;
}

async function runInit(files: Record<string, string>): Promise<CapturingIO> {
  const root = await makeProject(files);
  roots.push(root);
  const io = captureIO();
  expect(await init({ ...INIT_OPTIONS, projectPath: root } as InitOptions, io)).toEqual({ kind: 'ok' });
  return io;
}

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('init 治理链路的提示落在注入面（harness#149）', () => {
  it('Output Style 段（setupClaudeMdOutputStyle 调用点曾丢 io）：写入提示进捕获 stdout', async () => {
    const io = await runInit({ 'CLAUDE.md': '# CLAUDE.md\n\n项目说明\n' });
    expect(io.outText()).toContain('✅ 已在 CLAUDE.md 顶部写入 Output Style 段');
  });

  it('治理契约追加到既有 AGENTS.md：`已追加治理契约` 进捕获 stdout', async () => {
    const io = await runInit({ 'AGENTS.md': '# AGENTS.md\n\n既有导读\n' });
    expect(io.outText()).toContain('✅ 已追加治理契约 PRESERVE:governance 段到 AGENTS.md');
  });

  it('标记残缺（唯一提示）：`标记残缺…请人工修复` 进捕获 stdout', async () => {
    const io = await runInit({ 'AGENTS.md': '# AGENTS.md\n\n<!-- PRESERVE:governance -->\n残缺段\n' });
    expect(io.outText()).toContain('⚠️  AGENTS.md 中 PRESERVE:governance 标记残缺（只有单边），跳过治理契约写入，请人工修复');
  });

  it('新仓创建 AGENTS.md 治理段：创建提示进捕获 stdout', async () => {
    const io = await runInit({});
    expect(io.outText()).toContain('✅ 已创建 AGENTS.md 并写入治理契约 PRESERVE:governance 段');
  });
});

describe('writer 层 io 必传（源形状闸，防缺省兜底再回来）', () => {
  it('init.ts 里 `io: CommandIO = processIO` 只剩 init() 一处（对外入口保留缺省）', () => {
    const sites = INIT_SOURCE.split('\n').filter(line => line.includes('io: CommandIO = processIO'));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatch(/^export async function init\(/);
  });

  it('三个 writer 与落点路由的 io 均为必传形参', () => {
    for (const writer of [
      'setupClaudeMdOutputStyle',
      'setupAgentsMdConstraints',
      'setupClaudeMdConstraints',
      'setupGovernanceConstraints',
    ]) {
      expect(INIT_SOURCE).toMatch(
        new RegExp(`export async function ${writer}\\(projectPath: string, io: CommandIO\\)`),
      );
    }
  });

  it('setupGovernance 的调用点逐个传 io（不留裸 projectPath 调用）', () => {
    const governanceBody = INIT_SOURCE.slice(
      INIT_SOURCE.indexOf('async function setupGovernance('),
      INIT_SOURCE.indexOf('/**\n * 目录 CONTEXT.md 骨架的 plan'),
    );
    expect(governanceBody).toMatch(/await setupClaudeMdOutputStyle\(projectPath, io\)/);
    expect(governanceBody).toMatch(/await setupGovernanceConstraints\(projectPath, io\)/);
  });
});
