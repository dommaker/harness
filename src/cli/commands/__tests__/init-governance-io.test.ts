/**
 * 治理链路的 io 注入不逃逸（harness#149，ADR-0029 收窄）
 *
 * setupGovernance 手握 io，曾在调用点把它丢了（`setupClaudeMdOutputStyle(projectPath)`），
 * 被调方一律 `io: CommandIO = processIO` 兜成真实 stdout。真机输出正常，但注入面的
 * 测试看不见那些提示——`⚠️ …标记残缺…` 这类唯一提示写坏了没有测试会红。
 *
 * 本文件不 mock 任何 IO：在临时目录里真跑 init，断言治理段提示落在**注入面**。
 * ADR-0029：约束注入段 writer（setupAgentsMdConstraints / setupClaudeMdConstraints /
 * setupGovernanceConstraints）已随文本注入层关停删除，相关用例移除；
 * Output Style 段（通用 marker 机制）保留。
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

  it('标记残缺（唯一提示）：HARNESS_OUTPUT_STYLE 单边 → Output Style 注入告警进捕获 stdout', async () => {
    const io = await runInit({ 'CLAUDE.md': '# CLAUDE.md\n\n<!-- HARNESS_OUTPUT_STYLE_START -->\n半残段\n' });
    expect(io.outText()).toContain('⚠️  CLAUDE.md 中 HARNESS_OUTPUT_STYLE 标记残缺（单边或乱序），跳过 Output Style 注入，请人工修复');
  });
});

describe('writer 层 io 必传（源形状闸，防缺省兜底再回来）', () => {
  it('init.ts 里 `io: CommandIO = processIO` 只剩 init() 一处（对外入口保留缺省）', () => {
    const sites = INIT_SOURCE.split('\n').filter(line => line.includes('io: CommandIO = processIO'));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatch(/^export async function init\(/);
  });

  it('Output Style writer 的 io 为必传形参', () => {
    expect(INIT_SOURCE).toMatch(
      /export async function setupClaudeMdOutputStyle\(projectPath: string, io: CommandIO\)/,
    );
  });

  it('setupGovernance 的调用点逐个传 io（不留裸 projectPath 调用）', () => {
    const governanceBody = INIT_SOURCE.slice(
      INIT_SOURCE.indexOf('async function setupGovernance('),
      INIT_SOURCE.indexOf('/**\n * 目录 CONTEXT.md 骨架的 plan'),
    );
    expect(governanceBody).toMatch(/await setupClaudeMdOutputStyle\(projectPath, io\)/);
  });
});
