/**
 * sync-docs --agents（AGENTS.md 生成）测试
 */

import * as fs from 'fs';
import * as path from 'path';
import { syncDocs } from '../sync-docs';

describe('sync-docs --agents', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-sync-docs-agents');

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

  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  /**
   * 创建夹具仓库：package.json + .harness/config.yml + 知识库 + CLAUDE.md 治理块 + src/docs 目录
   */
  function createFixture(dir: string, opts: { pnpm?: boolean; withCapabilities?: boolean } = {}): void {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.harness', 'knowledge'), { recursive: true });

    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), '/**\n * App module\n */\nexport const app = 1;');
    fs.writeFileSync(path.join(dir, 'src', 'CONTEXT.md'), '# src\n\n夹具模块文档\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'fixture-app',
      description: '测试夹具项目',
      scripts: {
        dev: 'vite',
        build: 'tsc',
        test: 'jest',
        'test:e2e': 'jest e2e',
        typecheck: 'tsc --noEmit',
        lint: 'eslint .',
        start: 'node dist/index.js',
        clean: 'rimraf dist',
      },
    }, null, 2));
    fs.writeFileSync(path.join(dir, '.harness', 'config.yml'), 'preset: standard\nenabled: true\n');
    fs.writeFileSync(path.join(dir, '.harness', 'knowledge', 'k1.md'), '# k1\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
      '# CLAUDE.md',
      '',
      '## Governance Rules',
      '<!-- HARNESS_CONSTRAINTS_START -->',
      '### Iron Laws (违反将阻断)',
      '- **law_a**: 描述 a',
      '- **law_b**: 描述 b',
      '### Guidelines (应遵循)',
      '- **g_a**: 描述',
      '- **g_b**: 描述',
      '- **g_c**: 描述',
      '### Tips',
      '- **t_a**: 描述',
      '<!-- HARNESS_CONSTRAINTS_END -->',
    ].join('\n'));

    if (opts.pnpm) {
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 1\n');
    }
    if (opts.withCapabilities) {
      fs.writeFileSync(
        path.join(dir, 'CAPABILITIES.md'),
        '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| app | src/app.ts | App module |'
      );
    }
  }

  it('应该从夹具仓库生成 AGENTS.md（pnpm 项目）', async () => {
    const testDir = path.join(tempDir, 'gen-pnpm');
    createFixture(testDir, { pnpm: true });

    await syncDocs({ projectPath: testDir, agents: true });

    const agentsPath = path.join(testDir, 'AGENTS.md');
    expect(fs.existsSync(agentsPath)).toBe(true);
    const content = fs.readFileSync(agentsPath, 'utf-8');

    // 项目简介
    expect(content).toContain('**fixture-app** — 测试夹具项目');
    // 目录结构
    expect(content).toContain('`docs/`');
    expect(content).toContain('项目文档');
    expect(content).toContain('`src/`');
    expect(content).toContain('源码目录');
    // 常用命令（仅 curated，不含 clean；pnpm 前缀）
    expect(content).toContain('pnpm dev');
    expect(content).toContain('pnpm build');
    expect(content).toContain('pnpm test:e2e');
    expect(content).toContain('pnpm typecheck');
    expect(content).toContain('pnpm start');
    expect(content).not.toContain('clean');
    // 约束与治理
    expect(content).toContain('preset: standard');
    expect(content).toContain('Iron Laws 2 条、Guidelines 3 条');
    // 知识入口
    expect(content).toContain('项目知识库（1 条）');
    expect(content).toContain('CONTEXT.md');
    expect(content).toContain('现有 1 个');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('npm 项目应该使用 npm run 前缀', async () => {
    const testDir = path.join(tempDir, 'gen-npm');
    createFixture(testDir);

    await syncDocs({ projectPath: testDir, agents: true });

    const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('npm run build');
    expect(content).toContain('npm test');
    expect(content).toContain('npm start');
    expect(content).toContain('npm run typecheck');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('重复运行应该幂等（内容一致且 --check 通过）', async () => {
    const testDir = path.join(tempDir, 'idempotent');
    createFixture(testDir, { pnpm: true, withCapabilities: true });

    await syncDocs({ projectPath: testDir, agents: true });
    const first = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');

    // 第二次运行：无任何差异
    const secondRun = await syncDocs({ projectPath: testDir, agents: true });
    const second = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    expect(second).toBe(first);
    expect(secondRun).toBe(true);

    // --check 模式应通过
    const checkResult = await syncDocs({ projectPath: testDir, agents: true, check: true });
    expect(checkResult).toBe(true);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('--check 模式应该检测 AGENTS.md 缺失', async () => {
    const testDir = path.join(tempDir, 'check-missing');
    createFixture(testDir, { withCapabilities: true });

    const result = await syncDocs({ projectPath: testDir, agents: true, check: true });
    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('缺少 AGENTS.md'));
    // check 模式不写入
    expect(fs.existsSync(path.join(testDir, 'AGENTS.md'))).toBe(false);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('--check 模式应该检测内容漂移', async () => {
    const testDir = path.join(tempDir, 'check-drift');
    createFixture(testDir, { pnpm: true, withCapabilities: true });

    // 先生成
    await syncDocs({ projectPath: testDir, agents: true });

    // 漂移 1：手改 AGENTS.md
    fs.appendFileSync(path.join(testDir, 'AGENTS.md'), '\n手动追加的一行\n');
    expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(false);

    // 重新生成恢复
    await syncDocs({ projectPath: testDir, agents: true });
    expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(true);

    // 漂移 2：package.json 删除一个 curated 脚本
    const pkgPath = path.join(testDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    delete pkg.scripts.lint;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(false);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('未启用 --agents 时不应生成 AGENTS.md', async () => {
    const testDir = path.join(tempDir, 'no-agents');
    createFixture(testDir, { withCapabilities: true });

    const result = await syncDocs({ projectPath: testDir });
    expect(result).toBe(true);
    expect(fs.existsSync(path.join(testDir, 'AGENTS.md'))).toBe(false);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('--json 模式应该输出 agentsMd 状态', async () => {
    const testDir = path.join(tempDir, 'json-agents');
    createFixture(testDir, { withCapabilities: true });

    const result = await syncDocs({ projectPath: testDir, agents: true, check: true, json: true });
    expect(result).toBe(false);

    const jsonCall = consoleSpy.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
    );
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.stale).toBe(true);
    expect(parsed.agentsMd).toEqual({ file: 'AGENTS.md', exists: false, stale: true });
    expect(parsed.resolution.some((r: { action: string }) => r.action === 'sync-agents-md')).toBe(true);

    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
