/**
 * sync-docs 表格排版回归测试（harness#171）
 *
 * 症状：撤下 CAPABILITIES.md 的模块登记行时清空该行而非删行，残留空行把
 * CommonMark 表格切断。判定面 = 「上一行与下一行都是 `|` 表格行、本行为空」不得存在。
 * 正本修复在写路径（整行删除 + 存量收拢 + 空表收掉），--check 侧必须报待清理
 * （check/fix 同规则才收敛，ADR-0009 口径）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { captureIO, type CapturingIO } from '../../command-contract';
import { normalizeCapabilitiesTableLayout } from '../sync-docs/capabilities-syncer';
import { syncDocs } from '../sync-docs';

let io: CapturingIO;
beforeEach(() => {
  io = captureIO();
});

const HEADER = '| 模块 | 文件 | 说明 |\n|------|------|------|\n';

/** 「上一行与下一行都是表格行、本行为空」的行数 —— 本票的判定面 */
function countBlankRowsInsideTable(content: string): number {
  const lines = content.split('\n');
  let n = 0;
  for (let i = 1; i < lines.length - 1; i++) {
    if (
      lines[i].trim() === '' &&
      /^\s*\|/.test(lines[i - 1]) &&
      /^\s*\|/.test(lines[i + 1])
    ) {
      n++;
    }
  }
  return n;
}

/** 建一个 file 模式的最小工程：srcFiles 存在，CAPABILITIES.md 由 rows 拼出 */
function makeProject(
  name: string,
  srcFiles: string[],
  doc: string
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sync-docs-layout-${name}-`));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const f of srcFiles) {
    const file = path.join(dir, 'src', f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const x = 1;\n');
  }
  fs.writeFileSync(path.join(dir, 'CAPABILITIES.md'), doc);
  return dir;
}
const read = (dir: string) => fs.readFileSync(path.join(dir, 'CAPABILITIES.md'), 'utf-8');
const dataRow = (name: string, file: string, desc = 'D') => `| ${name} | ${file} | ${desc} |`;

describe('sync-docs CAPABILITIES.md 表格排版（#171）', () => {
  it('撤中间登记行：整行删除，表格保持连续', async () => {
    const dir = makeProject(
      'middle',
      ['a.ts', 'c.ts'],
      `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n${dataRow('b', 'src/b.ts')}\n${dataRow('c', 'src/c.ts')}\n`
    );

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).not.toContain('src/b.ts');
    expect(countBlankRowsInsideTable(out)).toBe(0);
    expect(out).toBe(`# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n${dataRow('c', 'src/c.ts')}\n`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('撤目录条目行（studio 撤登记形状）：同样整行删除', async () => {
    const dir = makeProject(
      'dir-entry',
      ['cli/cli.ts', 'harness/h.ts'],
      `# Capabilities\n\n${HEADER}` +
        `${dataRow('cli', 'src/cli/', 'C')}\n` +
        `${dataRow('hooks', 'src/hooks/', 'H')}\n` +
        `${dataRow('harness', 'src/harness/', 'A')}\n`
    );

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).not.toContain('src/hooks/');
    expect(countBlankRowsInsideTable(out)).toBe(0);
    expect(out).toContain(`${dataRow('cli', 'src/cli/', 'C')}\n${dataRow('harness', 'src/harness/', 'A')}`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('撤最后一行：不留文件末尾空行', async () => {
    const dir = makeProject(
      'last',
      ['a.ts'],
      `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n${dataRow('gone', 'src/gone.ts')}\n`
    );

    await syncDocs({ projectPath: dir }, io);

    expect(read(dir)).toBe(`# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n`);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('存量脏行（无其它漂移）：--check 报待清理，写模式收拢且收拢后 check 转绿', async () => {
    const dirty = `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n\n${dataRow('z', 'src/z.ts')}\n`;
    const dir = makeProject('legacy', ['a.ts', 'z.ts'], dirty);

    expect(countBlankRowsInsideTable(read(dir))).toBe(1);
    const check = await syncDocs({ projectPath: dir, check: true }, io);
    expect(check).toEqual({ kind: 'fail', reason: expect.stringContaining('表格') });

    await syncDocs({ projectPath: dir }, io);
    const out = read(dir);
    expect(countBlankRowsInsideTable(out)).toBe(0);
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/z.ts');
    expect(await syncDocs({ projectPath: dir, check: true }, io)).toEqual({ kind: 'ok' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('表格被撤空：连表头/分隔行一起收掉', async () => {
    const dir = makeProject(
      'empty-table',
      [],
      `# Capabilities\n\n${HEADER}${dataRow('gone1', 'src/gone1.ts')}\n${dataRow('gone2', 'src/gone2.ts')}\n`
    );

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).not.toContain('|------|');
    expect(out).not.toContain('模块 | 文件');
    expect(out).not.toMatch(/\n{3,}/);
    expect(await syncDocs({ projectPath: dir, check: true }, io)).toEqual({ kind: 'ok' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('撤登同时有新增：不得把仍要使用的表头收掉', async () => {
    const dir = makeProject(
      'remove-and-add',
      ['b.ts', 'fresh.ts'],
      `# Capabilities\n\n${HEADER}${dataRow('a', 'src/gone.ts')}\n${dataRow('b', 'src/b.ts')}\n`
    );

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).toContain('模块 | 文件 | 说明');
    expect(out).toContain('fresh.ts');
    expect(countBlankRowsInsideTable(out)).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('表格外的空行不动（段落分隔不是脏行）', async () => {
    const doc = `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n\n## 说明\n\n散文。\n`;
    const dir = makeProject('prose', ['a.ts'], doc);

    const check = await syncDocs({ projectPath: dir, check: true }, io);
    expect(check).toEqual({ kind: 'ok' });
    expect(read(dir)).toBe(doc);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('代码块内「表头+分隔行无数据行」的示例不被收掉', async () => {
    const doc =
      `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n\n` +
      `登记格式：\n\n\`\`\`markdown\n| 模块 | 文件 | 说明 |\n|------|------|------|\n\`\`\`\n\n散文。\n`;
    const dir = makeProject('fenced-empty-table', ['a.ts'], doc);

    expect(await syncDocs({ projectPath: dir, check: true }, io)).toEqual({ kind: 'ok' });

    await syncDocs({ projectPath: dir }, io);
    expect(read(dir)).toBe(doc);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('代码块内的表格样式行不被收拢（含块内空行）', async () => {
    const doc =
      `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n\n` +
      `示例：\n\n\`\`\`\n| x | y |\n\n| z | w |\n\`\`\`\n`;
    const dir = makeProject('fenced-blank-row', ['a.ts'], doc);

    expect(await syncDocs({ projectPath: dir, check: true }, io)).toEqual({ kind: 'ok' });

    await syncDocs({ projectPath: dir }, io);
    expect(read(dir)).toBe(doc);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('两张空表相邻：一次收拢即干净（规则互相制造触发点，须跑到不动点）', () => {
    // 规则①先吃掉两张空表之间的那个空行（两侧都是表格行），规则②在同一轮里
    // 只看得到「表头+分隔行后面还有表格行」的前一张，收得掉后一张。不迭代就收不干净。
    const first = normalizeCapabilitiesTableLayout(`${HEADER}\n${HEADER}`);

    expect(first).toEqual({ content: '', blankLines: 1, emptyTables: 2 });
    // 不动点：再跑一次零改动，`--check` 才不会修完还红
    expect(normalizeCapabilitiesTableLayout(first.content)).toEqual({
      content: '',
      blankLines: 0,
      emptyTables: 0,
    });
  });

  it('收掉空表后不留三个以上连续换行（写模式收干净）', async () => {
    const dir = makeProject(
      'no-triple-newline',
      [],
      `# Capabilities\n\n${HEADER}${dataRow('gone', 'src/gone.ts')}\n\n## 说明\n\n散文。\n`
    );

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain('## 说明');
    expect(out).toContain('散文。');
    expect(await syncDocs({ projectPath: dir, check: true }, io)).toEqual({ kind: 'ok' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('围栏内示例行引用已删文件：随幽灵行一起删掉，且 check 收敛（取舍见实现注释）', async () => {
    // 登记条目由 capabilities-parser 全文扫描得出（ADR-0009），块内行也算登记项；
    // 只让幽灵行删除豁免围栏，这个示例会永远被报成已删模块且修不掉。
    const doc =
      `# Capabilities\n\n${HEADER}${dataRow('a', 'src/a.ts')}\n\n` +
      `登记格式示例：\n\n\`\`\`markdown\n${HEADER}${dataRow('gone', 'src/gone.ts')}\n\`\`\`\n`;
    const dir = makeProject('fenced-ghost-entry', ['a.ts'], doc);

    expect(await syncDocs({ projectPath: dir, check: true }, io)).toMatchObject({ kind: 'fail' });
    expect(io.outText()).toContain('src/gone.ts');

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).not.toContain('src/gone.ts');
    expect(out).toContain(dataRow('a', 'src/a.ts'));
    // 只吃掉引用已删文件的那一行，块内其余正文留着（不是「把围栏里所有行一起删」）
    expect(out).toContain('```markdown\n' + HEADER);
    expect(countBlankRowsInsideTable(out)).toBe(0);
    expect(await syncDocs({ projectPath: dir, check: true }, io)).toEqual({ kind: 'ok' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CRLF 文档撤行：整行连行尾一起删除', async () => {
    const doc = `# Capabilities\r\n\r\n${HEADER.replace(/\n/g, '\r\n')}${dataRow('a', 'src/a.ts')}\r\n${dataRow('gone', 'src/gone.ts')}\r\n`;
    const dir = makeProject('crlf', ['a.ts'], doc);

    await syncDocs({ projectPath: dir }, io);

    const out = read(dir);
    expect(out).not.toContain('src/gone.ts');
    expect(out.endsWith(`${dataRow('a', 'src/a.ts')}\r\n`)).toBe(true);
    expect(countBlankRowsInsideTable(out)).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
