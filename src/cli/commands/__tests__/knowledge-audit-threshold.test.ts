/**
 * knowledge audit --threshold 的装配面测试（harness#152）
 *
 * 证的是「数值旗帜从 commander 到判定」这一程，不是投影：
 * ① 声明与运行时一致——`--threshold <n>` 恒给字符串，`knowledge.ts` 不得再靠 `as any` 躲编译期；
 * ② 脏输入 fail-loud——非零判定 + stderr 提示，不出报告、不写盘（原先 NaN 静默关掉短内容规则）；
 * ③ 缺省与显式 '50' 逐字同果、显式 '0' 不被当「未传」兜掉。
 * 用真 KnowledgeAudit：要证的是阈值落进判定，而非参数传到（那是 mock 入参断言的假绿）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock chalk（断言看文本，不看 ANSI）
jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  bold: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
  cyan: jest.fn((s: string) => s),
}));

import { captureIO, lastJsonOutput, type CapturingIO } from '../../command-contract';
import { FileKnowledgeStore } from '../../../knowledge/store';
import type { KnowledgeEntry } from '../../../knowledge/types';
import { knowledgeAudit } from '../knowledge';

const SRC_FILE = path.join(__dirname, '..', 'knowledge.ts');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY).toISOString();

/** 三条探针条目：30 / 25 字符在缺省阈值 50 下都算短，80 字符怎么都不算 */
const EDGE_30 = 'GUI-101';
const SHORT_25 = 'GUI-102';
const LONG_80 = 'GUI-103';

function makeEntry(id: string, content: string): KnowledgeEntry {
  return {
    id,
    type: 'guideline',
    title: `阈值探针 ${id}`,
    content,
    maturity: 'draft',
    layer: 'project',
    created: daysAgo(3),
    lastReferenced: daysAgo(1),
    contributors: [],
    projects: [],
    tags: [],
    applicablePhases: [],
    sourceReferences: [],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
  };
}

function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-k152-'));
  const store = new FileKnowledgeStore({ baseDir: dir });
  store.save(makeEntry(EDGE_30, 'x'.repeat(30)));
  store.save(makeEntry(SHORT_25, 'y'.repeat(25)));
  store.save(makeEntry(LONG_80, 'z'.repeat(80)));
  return dir;
}

let io: CapturingIO;
let dir: string;

beforeEach(() => {
  io = captureIO();
  dir = fixture();
});

/** 走 --json 面取短内容命中的条目 id（判定结果的正本面） */
async function shortContentIds(threshold?: string): Promise<string[]> {
  const probe = captureIO();
  const result = await knowledgeAudit({ dir, json: true, threshold }, probe);
  expect(result.kind).toBe('ok');
  const report = lastJsonOutput<{ issues: { rule: string; entryId: string }[] }>(probe);
  return report.issues.filter(i => i.rule === 'short-content').map(i => i.entryId).sort();
}

describe('knowledge audit --threshold：阈值真的进判定', () => {
  it('未传 = 缺省 50，与显式 "50" 逐字同果', async () => {
    expect(await shortContentIds(undefined)).toEqual([EDGE_30, SHORT_25].sort());
    expect(await shortContentIds('50')).toEqual([EDGE_30, SHORT_25].sort());
  });

  it('"30" 生效：恰好 30 字符的条目退出短内容判定，detail 打的是阈值 30', async () => {
    const result = await knowledgeAudit({ dir, json: true, threshold: '30' }, io);
    expect(result.kind).toBe('ok');
    const report = lastJsonOutput<{ issues: { rule: string; entryId: string; detail: string }[] }>(io);
    const hits = report.issues.filter(i => i.rule === 'short-content');
    expect(hits.map(i => i.entryId)).toEqual([SHORT_25]);
    expect(hits[0].detail).toContain('阈值 30');
  });

  it('显式 "0" 不被当「未传」兜掉：按 0 判定，一条不报（兜掉则回 50、报两条）', async () => {
    expect(await shortContentIds('0')).toEqual([]);
  });

  it('阈值随入参移动：40 两条都算短，29 只剩 25 字符那条', async () => {
    expect(await shortContentIds('40')).toEqual([EDGE_30, SHORT_25].sort());
    expect(await shortContentIds('29')).toEqual([SHORT_25]);
  });
});

describe('knowledge audit --threshold：脏输入 fail-loud（不再 NaN 穿透）', () => {
  const DIRTY = ['abc', '30abc', '1e2', '0.7', '-5', '', ' ', 'NaN', 'Infinity', '0x10'];

  it.each(DIRTY.map(v => [v]))('--threshold %o → usage-error + stderr 提示，stdout 零字节', async (raw) => {
    const result = await knowledgeAudit({ dir, json: true, threshold: raw }, io);
    expect(result).toEqual({ kind: 'usage-error', reason: expect.stringContaining('--threshold') });
    expect(io.outText()).toBe('');
    expect(io.errText()).toContain('阈值');
    if (raw.trim() !== '') expect(io.errText()).toContain(raw);
  });

  it('人读面同样不产出报告，且不落「阈值 NaN」这种自证异常的行', async () => {
    const result = await knowledgeAudit({ dir, threshold: 'abc' }, io);
    expect(result.kind).toBe('usage-error');
    expect(io.outText()).toBe('');
    expect(io.outText()).not.toContain('阈值 NaN');
  });

  it('脏值不写盘：审计后的索引重建随之不发生（人读路径的既有副作用）', async () => {
    const before = fs.readdirSync(dir).sort();
    await knowledgeAudit({ dir, threshold: 'abc' }, io);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });
});

describe('knowledge audit --threshold：声明与运行时一致', () => {
  it('knowledge.ts 零 as any（断言不得替编译器记住旗帜的实际形状）', () => {
    const offenders = fs.readFileSync(SRC_FILE, 'utf-8')
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(({ text }) => text.includes('as any'));
    expect(offenders).toEqual([]);
  });
});
