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
    // 知识入口（只写目录存在性，不写易变的条目数——避免 --check 漂移竞态）
    expect(content).toContain('项目知识库，用 `harness knowledge` 查询');
    expect(content).not.toContain('知识库（');
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

  it('yarn 项目应该使用 yarn 前缀执行脚本', async () => {
    const testDir = path.join(tempDir, 'gen-yarn');
    createFixture(testDir);
    fs.writeFileSync(path.join(testDir, 'yarn.lock'), '# yarn lockfile v1\n');

    await syncDocs({ projectPath: testDir, agents: true });

    const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('yarn dev');
    expect(content).toContain('yarn build');
    expect(content).toContain('yarn test');
    expect(content).toContain('yarn start');
    expect(content).not.toContain('npm run');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('知识入口行：.studio/CONTEXT.md 正本模型（studio #188）', () => {
    it('.studio/CONTEXT.md 存在时生成正本行，替代散置指引（散置文件同时在场也一样），--check 无漂移', async () => {
      const testDir = path.join(tempDir, 'studio-context-model');
      createFixture(testDir, { pnpm: true, withCapabilities: true });
      // 夹具已带散置 src/CONTEXT.md：正本在场时整行替代，与是否残留散置文件无关
      fs.mkdirSync(path.join(testDir, '.studio'), { recursive: true });
      fs.writeFileSync(path.join(testDir, '.studio', 'CONTEXT.md'), '# 模块上下文\n\n## src\n\n职责：夹具\n');

      await syncDocs({ projectPath: testDir, agents: true });

      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('模块上下文正本：`.studio/CONTEXT.md`（模块锚点组织），改动代码时同步更新');
      expect(content).not.toContain('各源码目录的 `CONTEXT.md`');
      expect(content).not.toContain('缺失目录可由 `harness sync-docs` 生成模板');
      // 知识库行不受影响
      expect(content).toContain('项目知识库，用 `harness knowledge` 查询');

      // 幂等 + --check 通过（正本模型下无漂移）
      const second = await syncDocs({ projectPath: testDir, agents: true });
      expect(second).toBe(true);
      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('.studio/CONTEXT.md 不存在时保持散置模型行，--check 无漂移', async () => {
      const testDir = path.join(tempDir, 'scattered-context-model');
      createFixture(testDir, { pnpm: true, withCapabilities: true });

      await syncDocs({ projectPath: testDir, agents: true });

      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('各源码目录的 `CONTEXT.md` 是权威模块文档（现有 1 个），改动代码时同步更新');
      expect(content).not.toContain('模块上下文正本');

      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('.studio/CONTEXT.md 是目录而非文件时不视为正本', async () => {
      const testDir = path.join(tempDir, 'studio-context-dir');
      createFixture(testDir, { pnpm: true, withCapabilities: true });
      fs.mkdirSync(path.join(testDir, '.studio', 'CONTEXT.md'), { recursive: true });

      await syncDocs({ projectPath: testDir, agents: true });

      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('各源码目录的 `CONTEXT.md` 是权威模块文档');
      expect(content).not.toContain('模块上下文正本');

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  it('空项目应该生成兜底内容（无 package.json、无治理配置、无知识库）', async () => {
    const testDir = path.join(tempDir, 'empty-project');
    // 只放应被跳过的目录：依赖/构建产物/隐藏目录
    fs.mkdirSync(path.join(testDir, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'coverage'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.next'), { recursive: true });
    fs.mkdirSync(path.join(testDir, '.vscode'), { recursive: true });

    const result = await syncDocs({ projectPath: testDir, agents: true });
    expect(result).toBe(false); // AGENTS.md 缺失 → 有问题，但已生成

    const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    // 项目名回退到目录名，无 description
    expect(content).toContain('**empty-project**');
    expect(content).not.toContain('**empty-project** —');
    // 兜底分支
    expect(content).toContain('（未检测到顶层目录）');
    expect(content).toContain('（package.json 中未检测到常用脚本）');
    expect(content).toContain('未检测到 harness 治理配置');
    expect(content).toContain('缺失目录可由 `harness sync-docs` 生成模板');
    expect(content).not.toContain('项目知识库');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('package.json 无 description 时回退 config.yml，required_dirs 缺失时静默跳过', async () => {
    const testDir = path.join(tempDir, 'config-fallback');
    fs.mkdirSync(path.join(testDir, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'cfg-app' }));
    fs.writeFileSync(path.join(testDir, '.harness', 'config.yml'), [
      'description: 来自配置的项目描述',
      'governance:',
      '  context_files:',
      '    enabled: true',
      '    required_dirs:',
      '      - src',
      '',
    ].join('\n'));

    const result = await syncDocs({ projectPath: testDir, agents: true });
    expect(result).toBe(false);

    // src 目录不存在：扫描/统计静默跳过，不中断生成
    const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    // description 来自 config.yml
    expect(content).toContain('**cfg-app** — 来自配置的项目描述');
    // 有治理配置但无 preset
    expect(content).toContain('治理配置：`.harness/config.yml`');
    expect(content).not.toContain('preset:');
    // .harness 是保留的知名隐藏目录
    expect(content).toContain('`.harness/`');

    // 写入模式已补建 src/CONTEXT.md
    expect(fs.existsSync(path.join(testDir, 'src', 'CONTEXT.md'))).toBe(true);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('monorepo 应该标注 apps/packages 成员、子包 description 与占位目录', async () => {
    const testDir = path.join(tempDir, 'monorepo');
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'src', 'app.ts'), '/**\n * App module\n */\nexport const app = 1;');
    fs.mkdirSync(path.join(testDir, 'apps', 'web'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'apps', 'api'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'apps', '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web' }));
    fs.writeFileSync(path.join(testDir, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api' }));
    fs.mkdirSync(path.join(testDir, 'packages'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'services'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'services', 'package.json'), JSON.stringify({ name: 'svc', description: '内部服务目录' }));
    fs.mkdirSync(path.join(testDir, 'misc'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({
      name: 'mono-app',
      description: '单仓项目',
      scripts: { test: 'jest' },
    }));

    const result = await syncDocs({ projectPath: testDir, agents: true });
    expect(result).toBe(false); // CAPABILITIES.md/AGENTS.md 缺失 → 已生成

    const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('| `apps/` | monorepo 应用：api、web |');
    expect(content).toContain('| `packages/` | monorepo 工作区 |');
    expect(content).toContain('| `services/` | 内部服务目录 |');
    expect(content).toContain('| `misc/` | — |');
    expect(content).toContain('| `src/` | 源码目录 |');

    // 无 CAPABILITIES.md 时应整体新建
    const caps = fs.readFileSync(path.join(testDir, 'CAPABILITIES.md'), 'utf-8');
    expect(caps).toContain('| app | src/app.ts |');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('CLAUDE.md 治理块无约束分节时不显示计数', async () => {
    const testDir = path.join(tempDir, 'governance-no-sections');
    createFixture(testDir, { withCapabilities: true });
    fs.writeFileSync(path.join(testDir, 'CLAUDE.md'), '# CLAUDE.md\n\n## Governance Rules\n\n（尚未配置约束）\n');

    await syncDocs({ projectPath: testDir, agents: true });

    const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Governance Rules 块');
    expect(content).not.toContain('Iron Laws');

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('--json 幂等时 agentsMd 应为 exists:true、stale:false', async () => {
    const testDir = path.join(tempDir, 'json-idempotent');
    createFixture(testDir, { pnpm: true, withCapabilities: true });

    await syncDocs({ projectPath: testDir, agents: true });

    const result = await syncDocs({ projectPath: testDir, agents: true, json: true });
    expect(result).toBe(true);

    const jsonCall = consoleSpy.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
    );
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.stale).toBe(false);
    expect(parsed.agentsMd).toEqual({ file: 'AGENTS.md', exists: true, stale: false });
    expect(parsed.resolution.some((r: { action: string }) => r.action === 'sync-agents-md')).toBe(false);

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('应该检测 CONTEXT.md 缺失/过时并给出 resolution（json + 人读输出）', async () => {
    const testDir = path.join(tempDir, 'context-stale');
    createFixture(testDir, { withCapabilities: true });
    // 启用 context_files 并要求 lib（不存在 → 缺失）
    fs.writeFileSync(path.join(testDir, '.harness', 'config.yml'), [
      'preset: standard',
      'governance:',
      '  context_files:',
      '    enabled: true',
      '    required_dirs:',
      '      - src',
      '      - lib',
      '',
    ].join('\n'));
    // src 子目录树：触发子目录递归扫描 + CONTEXT.md 过时检测
    fs.mkdirSync(path.join(testDir, 'src', 'modules', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'src', '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'src', 'modules', 'util.ts'), '/**\n * Util module\n */\nexport const util = 1;');
    fs.writeFileSync(path.join(testDir, 'src', 'modules', 'index.ts'), 'export * from \'./util\';');
    fs.writeFileSync(path.join(testDir, 'src', 'modules', 'deep', 'deep.ts'), '/**\n * Deep module\n */\nexport const deep = 1;');
    fs.writeFileSync(path.join(testDir, 'src', 'modules', 'CONTEXT.md'), '# modules\n');
    // 人为把 CONTEXT.md 的 mtime 拨到过去 → 源码比文档新 → 过时
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(testDir, 'src', 'modules', 'CONTEXT.md'), past, past);

    // json 模式：结构化输出缺失/过时
    const jsonResult = await syncDocs({ projectPath: testDir, agents: true, check: true, json: true });
    expect(jsonResult).toBe(false);
    const jsonCall = consoleSpy.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('{')
    );
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.summary.contextMissing).toBe(1);
    expect(parsed.summary.contextStale).toBe(1);
    expect(parsed.contextMissing).toEqual([{ dir: 'lib', file: 'lib/CONTEXT.md' }]);
    expect(parsed.contextStale).toEqual([{ dir: 'src/modules', file: 'src/modules/CONTEXT.md' }]);
    expect(parsed.resolution.some((r: { action: string }) => r.action === 'create-context-md')).toBe(true);
    expect(parsed.resolution.some((r: { action: string }) => r.action === 'update-context-md')).toBe(true);
    expect(parsed.agentsMd).toEqual({ file: 'AGENTS.md', exists: false, stale: true });

    // 人读模式：输出过时提示
    consoleSpy.mockClear();
    const humanResult = await syncDocs({ projectPath: testDir, agents: true, check: true });
    expect(humanResult).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('可能过时'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('缺少 CONTEXT.md'));

    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('PRESERVE 标记段保留', () => {
    const MANUAL_BLOCK = [
      '<!-- PRESERVE:manual -->',
      '## 手写区',
      '',
      '使用者自有内容',
      '<!-- /PRESERVE:manual -->',
    ].join('\n');

    function appendBlock(dir: string, block: string): void {
      fs.appendFileSync(path.join(dir, 'AGENTS.md'), block + '\n');
    }

    it('PRESERVE 块在重新生成时保留，组合结果幂等（--check 通过）', async () => {
      const testDir = path.join(tempDir, 'preserve-basic');
      createFixture(testDir, { pnpm: true, withCapabilities: true });

      await syncDocs({ projectPath: testDir, agents: true });
      appendBlock(testDir, MANUAL_BLOCK);

      // 追加块后构成漂移 → 写入模式重组：生成部分 + PRESERVE 块
      await syncDocs({ projectPath: testDir, agents: true });
      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain(MANUAL_BLOCK);
      // 块位于生成内容之后
      expect(content.indexOf('## 知识入口')).toBeLessThan(content.indexOf('<!-- PRESERVE:manual -->'));

      // 重组后幂等：--check 通过
      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('多个 PRESERVE 块保持原有相对顺序', async () => {
      const testDir = path.join(tempDir, 'preserve-order');
      createFixture(testDir, { pnpm: true, withCapabilities: true });

      await syncDocs({ projectPath: testDir, agents: true });
      appendBlock(testDir, '<!-- PRESERVE:one -->\n第一块\n<!-- /PRESERVE:one -->');
      appendBlock(testDir, '<!-- PRESERVE:two -->\n第二块\n<!-- /PRESERVE:two -->');
      await syncDocs({ projectPath: testDir, agents: true });

      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content.indexOf('PRESERVE:one')).toBeLessThan(content.indexOf('PRESERVE:two'));
      expect(content).toContain('第一块');
      expect(content).toContain('第二块');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('块内手改不报漂移，块外手改报漂移且重生成后块仍在', async () => {
      const testDir = path.join(tempDir, 'preserve-drift');
      createFixture(testDir, { pnpm: true, withCapabilities: true });

      await syncDocs({ projectPath: testDir, agents: true });
      appendBlock(testDir, MANUAL_BLOCK);
      await syncDocs({ projectPath: testDir, agents: true }); // 重组为规范形态

      // 块内手改 → 不报漂移
      const agentsPath = path.join(testDir, 'AGENTS.md');
      const edited = fs.readFileSync(agentsPath, 'utf-8').replace('使用者自有内容', '改过的内容');
      fs.writeFileSync(agentsPath, edited);
      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(true);

      // 块外手改（生成部分） → 报漂移；重生成后块仍在、块外改动被还原
      fs.appendFileSync(agentsPath, '\n块外手动追加\n');
      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(false);
      await syncDocs({ projectPath: testDir, agents: true });
      const regenerated = fs.readFileSync(agentsPath, 'utf-8');
      expect(regenerated).toContain('改过的内容');
      expect(regenerated).not.toContain('块外手动追加');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('未闭合的 PRESERVE 块不予保留并告警', async () => {
      const testDir = path.join(tempDir, 'preserve-malformed');
      createFixture(testDir, { pnpm: true, withCapabilities: true });

      await syncDocs({ projectPath: testDir, agents: true });
      appendBlock(testDir, '<!-- PRESERVE:broken -->\n没有结束标记');
      await syncDocs({ projectPath: testDir, agents: true });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未闭合'));
      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).not.toContain('PRESERVE:broken');
      expect(content).not.toContain('没有结束标记');

      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('仓库状态变化时报漂移：重生成更新生成部分且保留 PRESERVE 块', async () => {
      const testDir = path.join(tempDir, 'preserve-repo-change');
      createFixture(testDir, { pnpm: true, withCapabilities: true });

      await syncDocs({ projectPath: testDir, agents: true });
      appendBlock(testDir, MANUAL_BLOCK);
      await syncDocs({ projectPath: testDir, agents: true });

      // package.json 删除一个 curated 脚本 → 生成部分变化
      const pkgPath = path.join(testDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      delete pkg.scripts.lint;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(false);
      await syncDocs({ projectPath: testDir, agents: true });

      const content = fs.readFileSync(path.join(testDir, 'AGENTS.md'), 'utf-8');
      expect(content).not.toContain('pnpm lint');
      expect(content).toContain(MANUAL_BLOCK);
      expect(await syncDocs({ projectPath: testDir, agents: true, check: true })).toBe(true);

      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });
});
