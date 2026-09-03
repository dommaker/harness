// SDD Index Generator Tests (AC-9)
// Tests: scan docs/sdd/ subdirs with requirement.md → generate _index.md
// Format: slug|pmoNumber|status|title|tags
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Import will fail until implementation exists — this is intentional RED
import { SDDIndexGenerator } from '../index-generator';

describe('SDDIndexGenerator', () => {
  let tmpDir: string;
  let sddDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-index-test-'));
    sddDir = path.join(tmpDir, 'docs', 'sdd');
    fs.mkdirSync(sddDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSDD(slug: string, frontmatter: Record<string, unknown>): void {
    const dir = path.join(sddDir, slug);
    fs.mkdirSync(dir, { recursive: true });
    const lines = ['---'];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        lines.push(`${key}: [${value.map(v => `"${v}"`).join(', ')}]`);
      } else {
        lines.push(`${key}: "${value}"`);
      }
    }
    lines.push('---');
    lines.push('');
    lines.push(`# ${frontmatter.title || slug}`);
    fs.writeFileSync(path.join(dir, 'requirement.md'), lines.join('\n'));
  }

  it('generates index from SDD directories with requirement.md', () => {
    createSDD('jwt-auth', {
      slug: 'jwt-auth',
      status: 'done',
      title: 'JWT 认证系统',
      tags: ['auth', 'security'],
      pmoNumber: 'PM-001',
    });
    createSDD('user-management', {
      slug: 'user-management',
      status: 'confirmed',
      title: '用户管理',
      tags: ['user'],
      pmoNumber: 'PM-002',
    });

    const generator = new SDDIndexGenerator(tmpDir);
    const result = generator.regenerate();

    expect(result.count).toBe(2);
    expect(result.entries).toHaveLength(2);

    // Verify _index.md was written
    const indexPath = path.join(sddDir, '_index.md');
    expect(fs.existsSync(indexPath)).toBe(true);

    const content = fs.readFileSync(indexPath, 'utf-8');
    expect(content).toContain('jwt-auth|PM-001|done|JWT 认证系统|auth,security');
    expect(content).toContain('user-management|PM-002|confirmed|用户管理|user');
  });

  it('skips directories without requirement.md', () => {
    createSDD('has-req', { slug: 'has-req', status: 'done', title: 'Has Req' });
    // Create directory without requirement.md
    fs.mkdirSync(path.join(sddDir, 'no-req'), { recursive: true });

    const generator = new SDDIndexGenerator(tmpDir);
    const result = generator.regenerate();

    expect(result.count).toBe(1);
    expect(result.entries[0].slug).toBe('has-req');
  });

  it('skips status: stale SDDs', () => {
    createSDD('active-one', { slug: 'active-one', status: 'done', title: 'Active' });
    createSDD('stale-one', { slug: 'stale-one', status: 'stale', title: 'Stale' });

    const generator = new SDDIndexGenerator(tmpDir);
    const result = generator.regenerate();

    expect(result.count).toBe(1);
    expect(result.entries[0].slug).toBe('active-one');
  });

  it('handles missing pmoNumber (empty column)', () => {
    createSDD('no-pmo', { slug: 'no-pmo', status: 'done', title: 'No PMO' });

    const generator = new SDDIndexGenerator(tmpDir);
    const result = generator.regenerate();

    expect(result.count).toBe(1);
    // pmoNumber column should be empty: slug||status|title|tags
    expect(result.entries[0].pmoNumber).toBe('');
  });

  it('handles missing tags (empty column)', () => {
    createSDD('no-tags', { slug: 'no-tags', status: 'done', title: 'No Tags' });

    const generator = new SDDIndexGenerator(tmpDir);
    const result = generator.regenerate();

    expect(result.count).toBe(1);
    expect(result.entries[0].tags).toBe('');
  });

  it('throws when SDD directory does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-empty-'));

    expect(() => new SDDIndexGenerator(emptyDir).regenerate()).toThrow(/not found/);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('generates header with correct format', () => {
    createSDD('test', { slug: 'test', status: 'done', title: 'Test' });

    const generator = new SDDIndexGenerator(tmpDir);
    generator.regenerate();

    const indexPath = path.join(sddDir, '_index.md');
    const content = fs.readFileSync(indexPath, 'utf-8');

    expect(content).toContain('# SDD Index');
    expect(content).toContain('Auto-generated');
    expect(content).toContain('Total: 1 entries');
    expect(content).toContain('slug|pmoNumber|status|title|tags');
  });

  it('sorts entries by slug', () => {
    createSDD('zebra', { slug: 'zebra', status: 'done', title: 'Zebra' });
    createSDD('alpha', { slug: 'alpha', status: 'done', title: 'Alpha' });

    const generator = new SDDIndexGenerator(tmpDir);
    const result = generator.regenerate();

    expect(result.entries[0].slug).toBe('alpha');
    expect(result.entries[1].slug).toBe('zebra');
  });

  describe('frontmatter 收口（harness#89）', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    function writeRaw(slug: string, raw: string): void {
      const dir = path.join(sddDir, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'requirement.md'), raw);
    }

    it('未闭合：跳过并显式上报（收口前静默跳过）', () => {
      writeRaw('broken-open', '---\nslug: broken-open\nstatus: done\ntitle: "断头"\n');

      const result = new SDDIndexGenerator(tmpDir).regenerate();

      expect(result.count).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[harness\].*unterminated.*broken-open/);
    });

    it('闭合行不完整（--- 后带内容）：不再当闭合——上报并跳过（收口前会静默收录该条）', () => {
      writeRaw('bad-close', '---\nslug: bad-close\nstatus: done\n---broken\n\n# 正文\n');

      const result = new SDDIndexGenerator(tmpDir).regenerate();

      expect(result.count).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[harness\].*unterminated/);
    });

    it('YAML 非法：跳过并上报 invalid-yaml（收口前静默跳过）', () => {
      writeRaw('bad-yaml', '---\nslug: [1,\n---\n\n# 正文\n');

      const result = new SDDIndexGenerator(tmpDir).regenerate();

      expect(result.count).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toMatch(/\[harness\].*invalid-yaml/);
    });

    it('缺 frontmatter 与空 meta：静默跳过（absent 是合法输入，不上报）', () => {
      writeRaw('no-fm', '# 没有 frontmatter\n\n正文\n');
      writeRaw('empty-meta', '---\n\n---\n\n# 空头\n');

      const result = new SDDIndexGenerator(tmpDir).regenerate();

      expect(result.count).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('正文含 --- 分隔线不影响 meta 解析（sdd 只取 meta，body 有意忽略）', () => {
      writeRaw(
        'with-rules',
        '---\nslug: with-rules\nstatus: done\ntitle: "带分隔线"\n---\n\n# 带分隔线\n\n---\n\n## 处置\n'
      );

      const result = new SDDIndexGenerator(tmpDir).regenerate();

      expect(result.count).toBe(1);
      expect(result.entries[0].title).toBe('带分隔线');
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
