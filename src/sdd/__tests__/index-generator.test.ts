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
});
