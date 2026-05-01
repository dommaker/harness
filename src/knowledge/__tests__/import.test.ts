/**
 * ColdStartImporter 测试
 */

import { ColdStartImporter } from '../import';
import { KnowledgeStore } from '../store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ColdStartImporter', () => {
  let store: KnowledgeStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-'));
    store = new KnowledgeStore({ baseDir: path.join(tmpDir, '.harness', 'knowledge') });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('importFromCode', () => {
    it('应该从 package.json 提取技术栈知识', async () => {
      // 创建测试 package.json
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        description: 'A test project',
        dependencies: { express: '^4.0.0' },
        scripts: { test: 'jest' },
      }));

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['code'],
      });

      const results = await importer.importAll();
      expect(results.length).toBe(1);
      expect(results[0].entries.length).toBeGreaterThan(0);
      expect(results[0].entries.some(e => e.title.includes('技术栈'))).toBe(true);
    });

    it('应该扫描目录结构', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'));
      fs.mkdirSync(path.join(tmpDir, 'src', 'utils'));

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['code'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.some(e => e.title.includes('目录结构'))).toBe(true);
    });

    it('应该跳过不存在的文件', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['code'],
      });

      const results = await importer.importAll();
      // 没有 package.json 和 tsconfig.json，不应报错
      expect(results[0].errors.length).toBe(0);
    });
  });

  describe('importFromDocs', () => {
    it('应该导入 README.md', async () => {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test Project\nThis is a test.');

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.some(e => e.title.includes('README'))).toBe(true);
    });

    it('应该导入 docs/ 目录下的 markdown 文件', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));
      fs.writeFileSync(path.join(tmpDir, 'docs', 'guide.md'), '# Guide\nSome guide content.');

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.some(e => e.title.includes('guide'))).toBe(true);
    });

    it('应该限制文档大小', async () => {
      const longContent = 'x'.repeat(10000);
      fs.writeFileSync(path.join(tmpDir, 'README.md'), longContent);

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      const results = await importer.importAll();
      const readmeEntry = results[0].entries.find(e => e.title.includes('README'));
      expect(readmeEntry?.content.length).toBeLessThanOrEqual(5000);
    });

    it('应该跳过不存在的文档路径', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
        docPaths: ['nonexistent.md'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.length).toBe(0);
      expect(results[0].errors.length).toBe(0);
    });
  });

  describe('importManual', () => {
    it('应该导入手动条目', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['manual'],
        manualEntries: [
          { title: '团队约定', content: '使用 TypeScript', type: 'guideline', tags: ['team'] },
          { title: '架构决策', content: '使用微服务', type: 'decision' },
        ],
      });

      const results = await importer.importAll();
      expect(results[0].entries.length).toBe(2);
      expect(results[0].entries[0].title).toBe('团队约定');
      expect(results[0].entries[0].tags).toContain('team');
      expect(results[0].entries[0].tags).toContain('manual-import');
    });

    it('应该处理空手动条目', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['manual'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.length).toBe(0);
    });
  });

  describe('状态持久化', () => {
    it('应该保存和恢复导入状态', async () => {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');

      const importer1 = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      await importer1.importAll();
      const state1 = importer1.getState();
      expect(state1.completedSources).toContain('docs');
      expect(state1.totalImported).toBeGreaterThan(0);

      // 第二次导入应跳过已完成的源
      const importer2 = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      const results2 = await importer2.importAll();
      expect(results2.length).toBe(0); // 已跳过
    });

    it('应该重置状态', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['manual'],
        manualEntries: [{ title: 'Test', content: 'Content', type: 'guideline' }],
      });

      await importer.importAll();
      expect(importer.getState().totalImported).toBeGreaterThan(0);

      importer.resetState();
      const state = importer.getState();
      expect(state.totalImported).toBe(0);
      expect(state.completedSources.length).toBe(0);
    });
  });

  describe('importAll', () => {
    it('应该执行所有源的导入', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['code', 'docs', 'manual'],
        manualEntries: [{ title: 'Manual', content: 'Content', type: 'guideline' }],
      });

      const results = await importer.importAll();
      expect(results.length).toBe(3);
      expect(importer.getState().totalImported).toBeGreaterThan(0);
    });

    it('所有导入的条目应该是 draft 成熟度', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['manual'],
        manualEntries: [{ title: 'Test', content: 'Content', type: 'guideline' }],
      });

      await importer.importAll();
      const entries = store.list({ excludeArchived: false });
      expect(entries.every(e => e.maturity === 'draft')).toBe(true);
    });

    it('应该跳过已完成的源', async () => {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test');

      const importer1 = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });
      await importer1.importAll();

      // 第二次导入应该跳过
      const importer2 = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });
      const results = await importer2.importAll();
      expect(results.length).toBe(0);
    });
  });

  describe('importFromCode - tsconfig', () => {
    it('应该从 tsconfig.json 提取知识', async () => {
      fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'es2020', strict: true },
      }));

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['code'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.some(e => e.title.includes('TypeScript'))).toBe(true);
    });

    it('应该格式化 package.json 信息', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'my-app',
        version: '2.0.0',
        description: 'My application',
        dependencies: { react: '^18.0.0', axios: '^1.0.0' },
        devDependencies: { typescript: '^5.0.0' },
        scripts: { build: 'tsc', test: 'jest' },
      }));

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['code'],
      });

      const results = await importer.importAll();
      const techEntry = results[0].entries.find(e => e.title.includes('技术栈'));
      expect(techEntry).toBeDefined();
      expect(techEntry?.content).toContain('my-app');
      expect(techEntry?.content).toContain('react');
      expect(techEntry?.content).toContain('typescript');
      expect(techEntry?.content).toContain('build');
    });
  });

  describe('importFromGit', () => {
    it('应该处理非 git 目录', async () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['git'],
      });

      const results = await importer.importAll();
      // 非 git 目录应该有错误但不崩溃
      expect(results.length).toBe(1);
    });
  });

  describe('importFromDocs - 目录', () => {
    it('应该扫描 docs/ 目录下最多 10 个 markdown 文件', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));
      for (let i = 0; i < 15; i++) {
        fs.writeFileSync(path.join(tmpDir, 'docs', `doc-${i}.md`), `# Doc ${i}`);
      }

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      const results = await importer.importAll();
      // 最多 10 个文件 + README
      expect(results[0].entries.filter(e => e.title.includes('docs/')).length).toBeLessThanOrEqual(10);
    });

    it('应该跳过空文件', async () => {
      fs.mkdirSync(path.join(tmpDir, 'docs'));
      fs.writeFileSync(path.join(tmpDir, 'docs', 'empty.md'), '');

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.some(e => e.title.includes('empty.md'))).toBe(false);
    });

    it('应该支持自定义文档路径', async () => {
      fs.writeFileSync(path.join(tmpDir, 'GUIDE.md'), '# Guide content');

      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['docs'],
        docPaths: ['GUIDE.md'],
      });

      const results = await importer.importAll();
      expect(results[0].entries.some(e => e.title.includes('GUIDE'))).toBe(true);
    });
  });

  describe('getState', () => {
    it('应该返回状态副本', () => {
      const importer = new ColdStartImporter({
        projectRoot: tmpDir,
        store,
        sources: ['manual'],
      });

      const state = importer.getState();
      expect(state.projectRoot).toBe(tmpDir);
      expect(state.totalImported).toBe(0);
      // 副本修改不影响原状态
      state.totalImported = 999;
      expect(importer.getState().totalImported).toBe(0);
    });
  });
});
