/**
 * 数值旗帜装配口径推广测试（harness#154）
 *
 * #152 把判据落在 knowledge audit --threshold 一处，本票推广到其余数值旗帜：
 * - 定义表装配（mapActionArgs，转不出来抛 NumericFlagError → bin 映射 usage-error）：
 *   constraints report 三阈值、performance --coverage-threshold/--bundle-threshold、
 *   review --min-reviewers；
 * - 命令模块装配（parseNumericFlag 判别 + 就地 logError + usage-error）：
 *   knowledge search --limit、failure list --limit、passes-gate --coverage-threshold。
 * 证三件事：脏输入 fail-loud（非零 + stderr 点名旗帜 + stdout 零字节 + 零副作用）、
 * 合法路径逐字不变（未传 vs 显式缺省同果）、显式 '0' 不被当「未传」兜掉。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

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

import { captureIO, lastJsonOutput } from '../../command-contract';
import { COMMAND_DEFINITIONS } from '../definitions';
import { GATE_DEFINITIONS } from '../../../gates/definitions';
import { knowledgeSearchCommand } from '../knowledge';
import { failureList } from '../failure';
import { coverageCheck } from '../passes-gate';
import { FileKnowledgeStore } from '../../../knowledge/store';
import type { KnowledgeEntry } from '../../../knowledge/types';
import { FailureRecorder } from '../../../failure/recorder';
import { DEFAULT_FAILURE_LOG_FILE, ErrorType, FailureLevel } from '../../../types/failure';
import { NumericFlagError } from '../../../utils/numeric-flag';

const repoRoot = path.join(__dirname, '..', '..', '..', '..');
const distBin = path.join(repoRoot, 'bin', 'harness.js');
const hasDist = fs.existsSync(path.join(repoRoot, 'dist', 'cli', 'commands'));

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-k154-'));
}

// ========================================
// 定义表装配点（mapActionArgs → requireNumericFlag）
// ========================================

const reportDef = COMMAND_DEFINITIONS.find(d => d.command === 'constraints')!
  .children!.find(d => d.command === 'report')!;
const performanceCli = GATE_DEFINITIONS.find(g => g.id === 'performance')!.cli;
const reviewCli = GATE_DEFINITIONS.find(g => g.id === 'review')!.cli;

describe('constraints report 三阈值：装配点 fail-loud', () => {
  const valid = { json: false, zeroInterceptMin: '50', noiseFailRate: '0.8', noiseMinTotal: '20' };

  it('缺省字符串 → 数值（int/int/float 各归其形）', () => {
    expect(reportDef.mapActionArgs!([], valid)).toEqual([{
      projectPath: undefined,
      export: undefined,
      json: false,
      zeroInterceptMin: 50,
      noiseFailRate: 0.8,
      noiseMinTotal: 20,
    }]);
  });

  it.each([
    ['zeroInterceptMin', '--zero-intercept-min'],
    ['noiseFailRate', '--noise-fail-rate'],
    ['noiseMinTotal', '--noise-min-total'],
  ])('%s 脏值 → 抛 NumericFlagError 点名 %s（原先 NaN 静默减少候选、退出码 0）', (key, flag) => {
    let caught: unknown;
    try {
      reportDef.mapActionArgs!([], { ...valid, [key]: 'abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NumericFlagError);
    expect((caught as Error).message).toContain(flag);
    expect((caught as Error).message).toContain('"abc"');
  });

  it('显式 "0" → 0（不被当未传兜掉）', () => {
    const [args] = reportDef.mapActionArgs!([], { ...valid, zeroInterceptMin: '0' }) as [{ zeroInterceptMin: number }];
    expect(args.zeroInterceptMin).toBe(0);
  });
});

describe('门禁 performance / review：装配点 fail-loud', () => {
  it('performance 缺省字符串 → 数值；显式 "0" → 0', () => {
    const [args] = performanceCli.mapActionArgs!([], {
      coverage: true, coverageThreshold: '80', bundle: true, bundleThreshold: '500',
    }) as [{ coverageThreshold: number; bundleThreshold: number }];
    expect(args.coverageThreshold).toBe(80);
    expect(args.bundleThreshold).toBe(500);
    const [zeros] = performanceCli.mapActionArgs!([], {
      coverage: true, coverageThreshold: '0', bundle: true, bundleThreshold: '0',
    }) as [{ coverageThreshold: number; bundleThreshold: number }];
    expect(zeros.coverageThreshold).toBe(0);
    expect(zeros.bundleThreshold).toBe(0);
  });

  it.each([
    ['coverageThreshold', '--coverage-threshold'],
    ['bundleThreshold', '--bundle-threshold'],
  ])('performance %s 脏值 → 抛 NumericFlagError 点名 %s', (key, flag) => {
    let caught: unknown;
    try {
      performanceCli.mapActionArgs!([], { coverageThreshold: '80', bundleThreshold: '500', [key]: 'abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NumericFlagError);
    expect((caught as Error).message).toContain(flag);
  });

  it('review --min-reviewers：缺省 → 1，显式 "0" → 0，脏值抛错', () => {
    const [args] = reviewCli.mapActionArgs!([], { minReviewers: '1' }) as [{ minReviewers: number }];
    expect(args.minReviewers).toBe(1);
    const [zero] = reviewCli.mapActionArgs!([], { minReviewers: '0' }) as [{ minReviewers: number }];
    expect(zero.minReviewers).toBe(0);
    expect(() => reviewCli.mapActionArgs!([], { minReviewers: 'abc' })).toThrow(NumericFlagError);
  });
});

// ========================================
// 命令模块装配点（parseNumericFlag 判别 + 就地 usage-error）
// ========================================

const DAY = 24 * 60 * 60 * 1000;
function makeEntry(id: string, content: string): KnowledgeEntry {
  return {
    id,
    type: 'guideline',
    title: `探针 ${id}`,
    content,
    maturity: 'draft',
    layer: 'project',
    created: new Date(Date.now() - 3 * DAY).toISOString(),
    lastReferenced: new Date(Date.now() - DAY).toISOString(),
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

/** 两条都含 probe 的条目，store 落在 projectPath 约定位置（openKnowledgeStore 同径） */
function seedKnowledge(projectPath: string): void {
  const store = new FileKnowledgeStore({ baseDir: `${projectPath}/.harness/knowledge` });
  store.save(makeEntry('P-1', 'probe alpha'));
  store.save(makeEntry('P-2', 'probe beta'));
}

describe('knowledge search --limit：命令入口 fail-loud', () => {
  it('未传 vs 显式 "20" 逐字同果；"1" 真截断', async () => {
    const projectPath = tmp();
    seedKnowledge(projectPath);
    const unset = captureIO();
    const r1 = await knowledgeSearchCommand(['probe'], { projectPath, json: true }, unset);
    expect(r1.kind).toBe('ok');
    const explicit = captureIO();
    const r2 = await knowledgeSearchCommand(['probe'], { projectPath, json: true, limit: '20' }, explicit);
    expect(r2.kind).toBe('ok');
    expect(explicit.outText()).toBe(unset.outText());
    expect(lastJsonOutput<{ total: number }>(unset).total).toBe(2);

    const one = captureIO();
    await knowledgeSearchCommand(['probe'], { projectPath, json: true, limit: '1' }, one);
    expect(lastJsonOutput<{ total: number }>(one).total).toBe(1);
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('显式 "0" → 0 条（原先 0 || 20 静默落缺省）', async () => {
    const projectPath = tmp();
    seedKnowledge(projectPath);
    const io = captureIO();
    const r = await knowledgeSearchCommand(['probe'], { projectPath, json: true, limit: '0' }, io);
    expect(r.kind).toBe('ok');
    expect(lastJsonOutput<{ total: number }>(io).total).toBe(0);
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it.each(['abc', '1e2', '0.7', '-5', '0x10'])(
    '--limit %o → usage-error + stderr 点名，store 不构造、目录零新文件',
    async (raw) => {
      const projectPath = tmp();
      const io = captureIO();
      const r = await knowledgeSearchCommand(['probe'], { projectPath, json: true, limit: raw }, io);
      expect(r.kind).toBe('usage-error');
      expect(r).toEqual({ kind: 'usage-error', reason: expect.stringContaining('--limit') });
      expect(io.outText()).toBe('');
      expect(io.errText()).toContain('--limit');
      expect(io.errText()).toContain(`"${raw}"`);
      expect(fs.readdirSync(projectPath)).toEqual([]);
      fs.rmSync(projectPath, { recursive: true, force: true });
    },
  );
});

describe('failure list --limit：命令入口 fail-loud', () => {
  async function seedFailures(projectPath: string, count: number): Promise<void> {
    const recorder = new FailureRecorder({ logFile: path.join(projectPath, DEFAULT_FAILURE_LOG_FILE) });
    for (let i = 0; i < count; i++) {
      await recorder.record({
        type: ErrorType.AGENT_ERROR,
        level: FailureLevel.L2,
        message: `探针失败 ${i}`,
        timestamp: Date.now() + i,
      });
    }
  }

  it('显式 "20" 截到 20 条；显式 "0" = 不截断（既有语义钉住，非兜回缺省）', async () => {
    const projectPath = tmp();
    await seedFailures(projectPath, 25);
    const twenty = captureIO();
    const r1 = await failureList({ projectPath, json: true, limit: '20' }, twenty);
    expect(r1.kind).toBe('ok');
    expect(lastJsonOutput<{ total: number }>(twenty).total).toBe(20);

    const zero = captureIO();
    const r2 = await failureList({ projectPath, json: true, limit: '0' }, zero);
    expect(r2.kind).toBe('ok');
    expect(lastJsonOutput<{ total: number }>(zero).total).toBe(25);
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('程序内 number 入参形状不变（双形声明是对的）', async () => {
    const projectPath = tmp();
    await seedFailures(projectPath, 25);
    const io = captureIO();
    const r = await failureList({ projectPath, json: true, limit: 5 }, io);
    expect(r.kind).toBe('ok');
    expect(lastJsonOutput<{ total: number }>(io).total).toBe(5);
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  it('--limit abc → usage-error + stderr 点名，recorder 不构造、目录零新文件', async () => {
    const projectPath = tmp();
    const io = captureIO();
    const r = await failureList({ projectPath, json: true, limit: 'abc' }, io);
    expect(r).toEqual({ kind: 'usage-error', reason: expect.stringContaining('--limit') });
    expect(io.outText()).toBe('');
    expect(io.errText()).toContain('--limit');
    expect(io.errText()).toContain('"abc"');
    expect(fs.readdirSync(projectPath)).toEqual([]);
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
});

describe('passes-gate --coverage-threshold：命令入口 fail-loud', () => {
  it('脏值 → usage-error + stderr 点名，覆盖率检查不执行（原先打出自证异常的 "(x% < NaN%)"）', async () => {
    const projectPath = tmp();
    const io = captureIO();
    const r = await coverageCheck({ projectPath, coverageThreshold: 'abc' }, io);
    expect(r).toEqual({ kind: 'usage-error', reason: expect.stringContaining('--coverage-threshold') });
    expect(io.outText()).toBe('');
    expect(io.errText()).toContain('--coverage-threshold');
    expect(io.errText()).toContain('"abc"');
    fs.rmSync(projectPath, { recursive: true, force: true });
  });
});

// ========================================
// 端到端：真实 spawn bin/harness.js（dist 存在时）
// ========================================

// 与 bin-exit-mapping.test.ts 同规：CI 上 dist 缺失显式失败而非静默 skip（harness#99）
if (!hasDist && process.env.CI) {
  throw new Error('dist 未构建：数值旗帜端到端不得静默 skip —— CI 必须先 npm run build 再 npm test（harness#99）');
}

const smoke = hasDist ? describe : describe.skip;

smoke('端到端：脏输入 → 非零退出 + stderr 点名 + stdout 零字节 + 零副作用落盘', () => {
  const run = (argv: string[], cwd: string) => spawnSync(process.execPath, [distBin, ...argv], {
    cwd,
    encoding: 'utf-8',
    timeout: 60000,
  });

  /** 四组静默降级站点（票面「确切缺口」1/2/3/4）+ performance --coverage-threshold */
  it.each([
    [['constraints', 'report', '--zero-intercept-min', 'abc'], '--zero-intercept-min'],
    [['constraints', 'report', '--noise-fail-rate', 'abc'], '--noise-fail-rate'],
    [['constraints', 'report', '--noise-min-total', 'abc'], '--noise-min-total'],
    [['knowledge', 'search', 'probe', '--limit', 'abc'], '--limit'],
    [['failure', 'list', '--limit', 'abc'], '--limit'],
    [['performance', '--bundle', '--bundle-threshold', 'abc'], '--bundle-threshold'],
    [['performance', '--coverage', '--coverage-threshold', 'abc'], '--coverage-threshold'],
  ])('%j → exit 1', (argv, flag) => {
    const projectPath = tmp();
    try {
      const r = run([...argv, '-p', projectPath], projectPath);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(flag);
      expect(r.stderr).toContain('"abc"');
      expect(r.stdout).toBe('');
      expect(fs.readdirSync(projectPath)).toEqual([]);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('review --min-reviewers abc → exit 1（fail-closed 面同样收敛为 fail-loud）', () => {
    const projectPath = tmp();
    try {
      const r = run(['review', '--min-reviewers', 'abc', '-p', projectPath], projectPath);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('--min-reviewers');
      expect(fs.readdirSync(projectPath)).toEqual([]);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('passes-gate --coverage --coverage-threshold abc → exit 1（usage-error，先于覆盖率执行）', () => {
    const projectPath = tmp();
    try {
      const r = run(['passes-gate', '--coverage', '--coverage-threshold', 'abc', '-p', projectPath], projectPath);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('--coverage-threshold');
      expect(fs.readdirSync(projectPath)).toEqual([]);
    } finally {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('合法路径逐字不变：未传 vs 显式缺省值，stdout 逐字相等', () => {
    const pairs: string[][][] = [
      [
        ['constraints', 'report'],
        ['constraints', 'report', '--zero-intercept-min', '50', '--noise-fail-rate', '0.8', '--noise-min-total', '20'],
      ],
      [
        ['failure', 'list'],
        ['failure', 'list', '--limit', '20'],
      ],
      [
        ['knowledge', 'search', 'probe'],
        ['knowledge', 'search', 'probe', '--limit', '20'],
      ],
    ];
    for (const [unset, explicit] of pairs) {
      const projectPath = tmp();
      try {
        const r1 = run([...unset, '-p', projectPath], projectPath);
        const r2 = run([...explicit, '-p', projectPath], projectPath);
        expect(r2.status).toBe(r1.status);
        expect(r2.stdout).toBe(r1.stdout);
      } finally {
        fs.rmSync(projectPath, { recursive: true, force: true });
      }
    }
  });
});
