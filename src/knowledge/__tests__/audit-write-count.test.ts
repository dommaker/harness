/**
 * 一次 `audit --fix` 的索引重写计数闸（harness#134 验收 2）
 *
 * 手法照 `src/cli/commands/__tests__/check-read-count.test.ts`：真执行、只在中间记一笔，
 * 不改任何行为。数的是**底层 index.json 被重写了几次**——`store.writeIndex()` 的唯一出口
 * 就是 `fs.writeFileSync(index.json)`，而 fs 属性不可 spyOn，故按该文件的做法整体 mock。
 *
 * 收口前：一次修复 = 一次 `store.update()` = 一次全量索引重写 → 计数 = 问题条数。
 * 收口后：整批经 `store.applyAll()` → 计数 = 1。夹具必须让四种修复动作都真发生，
 * 否则闸门是空跑的。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KnowledgeAudit } from '../audit';
import { FileKnowledgeStore } from '../store';
import type { KnowledgeEntry } from '../types';

type WriteCall = { file: string };

// 计数器挂在 globalThis：jest.mock 工厂会被提前调用，闭包外提会撞 TDZ
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const g = globalThis as unknown as { __H134_INDEX_WRITES__?: WriteCall[] };
  if (!g.__H134_INDEX_WRITES__) g.__H134_INDEX_WRITES__ = [];
  const bucket = g.__H134_INDEX_WRITES__;
  const name = (p: unknown): string => (Buffer.isBuffer(p) ? p.toString('utf8') : String(p));

  return {
    ...actual,
    writeFileSync: jest.fn((p: unknown, ...rest: unknown[]) => {
      bucket.push({ file: name(p) });
      return (actual.writeFileSync as (...args: unknown[]) => unknown)(p, ...rest);
    }),
  };
});

const writes = () =>
  ((globalThis as unknown as { __H134_INDEX_WRITES__?: WriteCall[] }).__H134_INDEX_WRITES__ ||= []);

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'WC-001',
    type: 'guideline',
    title: 'Write Count Entry',
    content: 'Some meaningful content that is long enough to pass thresholds',
    maturity: 'verified',
    layer: 'project',
    created: new Date().toISOString(),
    lastReferenced: new Date().toISOString(),
    contributors: ['tester'],
    projects: ['probe'],
    tags: [],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
    ...overrides,
  };
}

/** 四种修复动作各一条：archive（测试标签）/ demote（零内容 proven）/ flag（短内容）/ trim（refs 膨胀） */
function fixtureEntries(): KnowledgeEntry[] {
  return [
    makeEntry({ id: 'WC-ARCH', title: 'Archive Me', maturity: 'verified', tags: ['test-scope-wc'] }),
    makeEntry({ id: 'WC-DEMOTE', title: 'Demote Me', maturity: 'proven', content: 'tiny' }),
    makeEntry({ id: 'WC-FLAG', title: 'Flag Me', maturity: 'verified', content: 'a'.repeat(30) }),
    makeEntry({
      id: 'WC-TRIM',
      title: 'Trim Me',
      maturity: 'verified',
      sourceReferences: Array.from({ length: 25 }, (_, i) => ({ workflow: `wf-${i}`, timestamp: '' })),
    }),
  ];
}

describe('一次 audit --fix 的 index.json 重写计数（harness#134）', () => {
  let dir: string;

  beforeEach(() => {
    writes().length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-write-count-'));
    const seed = new FileKnowledgeStore({ baseDir: dir });
    for (const entry of fixtureEntries()) seed.save(entry);
    writes().length = 0; // 只数审计这一段
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('4 条修复只重写一次 index.json，条目文件各重写一次', () => {
    const audit = new KnowledgeAudit(new FileKnowledgeStore({ baseDir: dir }));
    const report = audit.run({ autoFix: true });

    // 正对照：四种动作全部真发生
    expect(report.autoFixed).toBe(4);

    const indexWrites = writes().filter(w => path.basename(w.file) === 'index.json');
    const entryWrites = writes().filter(w => w.file.endsWith('.md'));
    expect(indexWrites).toHaveLength(1);
    expect(entryWrites.map(w => path.basename(w.file)).sort()).toEqual([
      'guideline-WC-ARCH.md',
      'guideline-WC-DEMOTE.md',
      'guideline-WC-FLAG.md',
      'guideline-WC-TRIM.md',
    ]);
  });

  it('无修复项时零索引重写（applyAll 空批不落盘）', () => {
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-write-count-clean-'));
    const seed = new FileKnowledgeStore({ baseDir: cleanDir });
    seed.save(makeEntry({
      id: 'WC-CLEAN',
      title: 'Perfectly Ordinary Title',
      maturity: 'verified',
      content: 'x'.repeat(200),
      referencedBy: ['someone:2026-09-14'],
    }));
    writes().length = 0;

    const report = new KnowledgeAudit(new FileKnowledgeStore({ baseDir: cleanDir })).run({ autoFix: true });

    expect(report.autoFixed).toBe(0); // 正对照：确实无可修项
    expect(writes().filter(w => path.basename(w.file) === 'index.json')).toHaveLength(0);
    fs.rmSync(cleanDir, { recursive: true, force: true });
  });
});
