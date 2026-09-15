/**
 * tone 映射冻结闸（harness#151）
 *
 * #133 的人读侧冻成「identity chalk 之下的逐行文本基线」（`knowledge-view.test.ts:20-21`，
 * 注释写明「人读断言看的是文本，不看 ANSI」）。代价是渲染类映射里唯一没被钉住的维度就是
 * **颜色本身**：`grep -rn "toneForMaturity\|TONE_STYLES" src/cli/commands/__tests__` 零命中，
 * 于是把 `toneForMaturity('verified')` 改回 `'warn'`（#133 有意偏离③ 的回退）、或把
 * `TONE_STYLES.accent` 换成 `chalk.yellow`，全仓零红。本文件把那两张表逐格钉住，且不经 identity mock：
 *
 * 1. **输入值 → tone**：`toneForMaturity` / `toneForSeverity` / `toneForScore` 每个键一格。
 * 2. **tone → chalk 样式键**：`TONE_STYLES` 每个档位一格。chalk 替身按样式键给文本加标签，
 *    断言走 `renderDisplayModel` / `announce` 的真实渲染链（`{cells:[{tone}]}` → 上色），
 *    不是只读表——表读得到、链断了也算漏。
 * 3. **表键集合穷尽**：本文件的登记表与源码里的 `DisplayTone` 联合、`TONE_STYLES` 字面量
 *    逐字对撞。新增档位不登记即红（编译期 `Record<…, …>` 与运行期集合对撞双钉）。
 *
 * 生产侧零改动：`TONE_STYLES` 保持模块内私有——本闸要钉的是它的行为（经渲染链）与它的
 * 声明形状（源码对撞），不是它的可访问性。导出它会动 `knowledge-view.ts` 的公开面。
 */

import * as fs from 'fs';
import * as path from 'path';

// chalk 替身：每个样式键把文本包成 "<key>文本</key>"，「这一格走了哪个样式」由此成为可断言的文本。
// 与 knowledge-view.test.ts 的 identity mock 相反——那份为的是读文案，这份为的是读颜色。
jest.mock('chalk', () => {
  const tag = (key: string) => (text: string): string => `<${key}>${String(text)}</${key}>`;
  return {
    blue: tag('blue'),
    bold: tag('bold'),
    green: tag('green'),
    yellow: tag('yellow'),
    red: tag('red'),
    gray: tag('gray'),
    cyan: tag('cyan'),
  };
});

import { captureIO } from '../../command-contract';
import {
  announce, renderDisplayModel,
  toneForMaturity, toneForScore, toneForSeverity,
  type DisplayCell, type DisplayModel, type DisplayTone, type SeverityName,
} from '../knowledge-view';
import type { MaturityLevel } from '../../../knowledge/types';

const VIEW_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'knowledge-view.ts'), 'utf-8');

const wrap = (style: string, text: string): string => `<${style}>${text}</${style}>`;

/** 把若干格塞进单 section 单 row，走真实渲染链 */
function renderCells(...cells: DisplayCell[]): string[] {
  const model: DisplayModel = { sections: [{ rows: [{ cells }] }] };
  const io = captureIO();
  renderDisplayModel(io, model);
  return io.outLines();
}

function renderSectionTitle(title: string): string[] {
  const io = captureIO();
  renderDisplayModel(io, { sections: [{ title, rows: [] }] });
  return io.outLines();
}

// ========================================
// 登记表 1：tone → chalk 样式键（源码 TONE_STYLES 的测试侧镜像）
// ========================================

/**
 * 缺键即编译期红（`Record<DisplayTone, …>` 要求全键），另有与源码字面量的运行期对撞闸。
 * 这张表是人读面颜色语义的唯一登记处：改色要在源码改一笔、这里改一笔，diff 即评审材料。
 */
const TONE_TO_STYLE: Record<DisplayTone, string> = {
  heading: 'blue',
  accent: 'cyan',
  emph: 'bold',
  muted: 'gray',
  ok: 'green',
  warn: 'yellow',
  error: 'red',
};

const TONE_KEYS = Object.keys(TONE_TO_STYLE) as DisplayTone[];

/** 源码里 `export type DisplayTone = 'a' | 'b' | …` 的成员清单 */
function declaredTones(): string[] {
  const decl = /export type DisplayTone =([^;]+);/.exec(VIEW_SOURCE);
  if (!decl) {
    throw new Error('源码里找不到 DisplayTone 声明——本闸的穷尽判据随之失效，去看一眼 knowledge-view.ts');
  }
  return [...decl[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

/** 源码里 `TONE_STYLES` 字面量的 `{ tone: chalk.<style> }` 条目 */
function declaredToneStyles(): Array<{ tone: string; style: string }> {
  const start = VIEW_SOURCE.indexOf('const TONE_STYLES');
  if (start < 0) {
    throw new Error('源码里找不到 TONE_STYLES——上色单表被搬走或改名，本闸需要跟着搬家');
  }
  const end = VIEW_SOURCE.indexOf('\n};', start);
  const entries = [...VIEW_SOURCE.slice(start, end).matchAll(/^\s*(\w+):\s*chalk\.(\w+),$/gm)]
    .map(m => ({ tone: m[1], style: m[2] }));
  if (entries.length === 0) throw new Error('TONE_STYLES 里解析不出任何条目——正则与源码形状脱节');
  return entries;
}

// ========================================
// 登记表 2：输入值 → tone（三张映射表的测试侧镜像）
// ========================================

/** 成熟度→角色：Record 全键，`MaturityLevel` 新增成员不登记即编译期红 */
const MATURITY_TO_TONE: Record<MaturityLevel, DisplayTone> = {
  draft: 'warn',
  verified: 'accent', // #133 有意偏离③：stats 人读面由此格决定是青不是黄
  proven: 'ok',
  archived: 'muted',
  active: 'warn',
  deprecated: 'warn',
};

/** severity→角色：审计条目的 critical/high/medium/low 与 health 问题的 error/warn/info 共用一张表 */
const SEVERITY_TO_TONE: Record<SeverityName, DisplayTone> = {
  critical: 'error',
  high: 'warn',
  medium: 'muted',
  low: 'muted',
  error: 'error',
  warn: 'warn',
  info: 'muted',
};

/** 0-100 分的档位边界：≥80 / ≥60 / 其余 */
const SCORE_TO_TONE: Array<{ score: number; tone: DisplayTone }> = [
  { score: 100, tone: 'ok' },
  { score: 80, tone: 'ok' },
  { score: 79, tone: 'warn' },
  { score: 60, tone: 'warn' },
  { score: 59, tone: 'error' },
  { score: 0, tone: 'error' },
];

describe('输入值 → tone：三张映射逐格冻结', () => {
  for (const [level, tone] of Object.entries(MATURITY_TO_TONE)) {
    it(`toneForMaturity('${level}') = '${tone}'`, () => {
      expect(toneForMaturity(level as MaturityLevel)).toBe(tone);
    });
  }

  for (const [severity, tone] of Object.entries(SEVERITY_TO_TONE)) {
    it(`toneForSeverity('${severity}') = '${tone}'`, () => {
      expect(toneForSeverity(severity as SeverityName)).toBe(tone);
    });
  }

  for (const { score, tone } of SCORE_TO_TONE) {
    it(`toneForScore(${score}) = '${tone}'`, () => {
      expect(toneForScore(score)).toBe(tone);
    });
  }

  it('三张映射的输出恒在样式表键集内（不会映射出一个没人上色的 tone）', () => {
    const produced: DisplayTone[] = [
      ...Object.keys(MATURITY_TO_TONE).map(l => toneForMaturity(l as MaturityLevel)),
      ...Object.keys(SEVERITY_TO_TONE).map(s => toneForSeverity(s as SeverityName)),
      ...SCORE_TO_TONE.map(({ score }) => toneForScore(score)),
    ];
    for (const tone of produced) {
      expect(TONE_TO_STYLE[tone]).toEqual(expect.any(String));
    }
  });
});

describe('tone → chalk 样式键：TONE_STYLES 逐格冻结（经真实渲染链）', () => {
  for (const tone of TONE_KEYS) {
    it(`${tone} 渲染走 chalk.${TONE_TO_STYLE[tone]}`, () => {
      expect(renderCells({ label: 'X', tone })).toEqual([wrap(TONE_TO_STYLE[tone], 'X')]);
    });
  }

  it('未声明 tone 的格不上色：渲染链不套任何样式', () => {
    expect(renderCells({ label: 'plain' })).toEqual(['plain']);
  });

  it('section 标题恒走 emph（tone 由渲染器决定，不经格）', () => {
    expect(renderSectionTitle('  按成熟度:')).toEqual([wrap('bold', '  按成熟度:')]);
  });

  it('announce 缺省走 heading、显式 tone 照表，--json 下静默', () => {
    const headingIo = captureIO();
    announce(headingIo, false, '📊 取数中');
    expect(headingIo.outLines()).toEqual([wrap('blue', '📊 取数中')]);

    const warnIo = captureIO();
    announce(warnIo, false, '⚠ 降级', 'warn');
    expect(warnIo.outLines()).toEqual([wrap('yellow', '⚠ 降级')]);

    const jsonIo = captureIO();
    announce(jsonIo, true, '📊 取数中');
    expect(jsonIo.outText()).toBe('');
  });

  it('表键集合穷尽：登记表 = 源码 DisplayTone 联合 = TONE_STYLES 字面量键', () => {
    expect(TONE_KEYS.slice().sort()).toEqual(declaredTones().sort());
    expect(declaredToneStyles().map(e => e.tone).sort()).toEqual(TONE_KEYS.slice().sort());
  });

  it('逐格对撞：源码 TONE_STYLES 的样式键 = 登记表（源码改一格即红）', () => {
    for (const { tone, style } of declaredToneStyles()) {
      expect(TONE_TO_STYLE[tone as DisplayTone]).toBe(style);
    }
  });
});

/**
 * 整条链（#133 偏离③ 的回退就是沿这条链发生的）：输入值 → toneForXxx → 格的 tone → 渲染上色。
 * 只钉前两张表也能抓到回退，这条钉的是「命令侧真拿它去渲染」这个用法本身。
 */
describe('两表串成一条链：输入值经映射后渲染出的样式 = 样式键表的落点', () => {
  for (const [level, tone] of Object.entries(MATURITY_TO_TONE)) {
    it(`成熟度 ${level} 的人读格渲染成 chalk.${TONE_TO_STYLE[tone]}`, () => {
      const text = `  [${level}]`;
      expect(renderCells({ label: text, tone: toneForMaturity(level as MaturityLevel) }))
        .toEqual([wrap(TONE_TO_STYLE[tone], text)]);
    });
  }

  for (const { score, tone } of SCORE_TO_TONE) {
    it(`健康分 ${score} 的人读格渲染成 chalk.${TONE_TO_STYLE[tone]}`, () => {
      const text = `  健康分: ${score}/100`;
      expect(renderCells({ label: text, tone: toneForScore(score) }))
        .toEqual([wrap(TONE_TO_STYLE[tone], text)]);
    });
  }

  it('一格多 tone：同排相邻格各自上色，互不吞并', () => {
    expect(renderCells(
      { label: '  [verified]', tone: toneForMaturity('verified') },
      { label: ' | ', tone: 'muted' },
      { label: '条目 K-002', tone: 'emph' },
    )).toEqual([
      `${wrap('cyan', '  [verified]')}${wrap('gray', ' | ')}${wrap('bold', '条目 K-002')}`,
    ]);
  });
});
