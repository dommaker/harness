/**
 * construction-sites 判定纯函数测试（harness#202 / ADR-0039）
 *
 * 钉三件事：
 * 1. 标记解析——`<!-- sync-docs:construction-sites X = N -->`（可选 `include: tests`），
 *    无标记散文与畸形标记不判；
 * 2. 计数口径——只数 `new X(`（含一层泛型实参）直构造，工厂封装调用不算；
 * 3. 判定——期望数与采集数不符即漂移，点名类名/期望/实际。
 */

import {
  parseConstructionSiteMarkers,
  tallyConstructionSites,
  reconcileConstructionSites,
} from '../construction-sites';

describe('parseConstructionSiteMarkers', () => {
  it('解析基本标记', () => {
    const markers = parseConstructionSiteMarkers(
      '# doc\n\n- 构造点一处\n<!-- sync-docs:construction-sites FileKnowledgeStore = 1 -->\n'
    );
    expect(markers).toEqual([{ className: 'FileKnowledgeStore', expected: 1, includeTests: false }]);
  });

  it('解析 include: tests 选项', () => {
    const markers = parseConstructionSiteMarkers(
      '<!-- sync-docs:construction-sites Widget = 3 include: tests -->'
    );
    expect(markers).toEqual([{ className: 'Widget', expected: 3, includeTests: true }]);
  });

  it('同一份文档可带多个标记', () => {
    const markers = parseConstructionSiteMarkers(
      [
        '<!-- sync-docs:construction-sites Foo = 1 -->',
        '散文',
        '<!-- sync-docs:construction-sites Bar = 2 include: tests -->',
      ].join('\n')
    );
    expect(markers).toEqual([
      { className: 'Foo', expected: 1, includeTests: false },
      { className: 'Bar', expected: 2, includeTests: true },
    ]);
  });

  it('无标记的散文不判（含普通 HTML 注释）', () => {
    expect(parseConstructionSiteMarkers('# doc\n\n- 仓内构造点两处\n<!-- 普通注释 -->\n')).toEqual([]);
  });

  it('畸形标记不判（缺数字 / 未知选项 / 缺类名）', () => {
    expect(parseConstructionSiteMarkers('<!-- sync-docs:construction-sites Foo = -->')).toEqual([]);
    expect(parseConstructionSiteMarkers('<!-- sync-docs:construction-sites Foo = 1 include: docs -->')).toEqual([]);
    expect(parseConstructionSiteMarkers('<!-- sync-docs:construction-sites = 1 -->')).toEqual([]);
  });
});

describe('tallyConstructionSites', () => {
  it('数 `new X(` 直构造出现次数', () => {
    const tally = tallyConstructionSites(
      'const a = new Widget();\nconst b = new Widget({ x: 1 });\n'
    );
    expect(tally.get('Widget')).toBe(2);
  });

  it('一层泛型实参的构造也算（new Map<string, boolean>()）', () => {
    const tally = tallyConstructionSites('const m = new Map<string, boolean>();\n');
    expect(tally.get('Map')).toBe(1);
  });

  it('工厂封装调用不算构造点', () => {
    const tally = tallyConstructionSites(
      'const s = openKnowledgeStore({}, io);\nconst w = createWidget();\n'
    );
    expect(tally.size).toBe(0);
  });

  it('标识符边界：new FooBar( 不算 Foo', () => {
    const tally = tallyConstructionSites('const x = new FooBar();\n');
    expect(tally.get('Foo')).toBeUndefined();
    expect(tally.get('FooBar')).toBe(1);
  });

  it('new 与类名间允许空白', () => {
    const tally = tallyConstructionSites('const x = new  Widget ();\n');
    expect(tally.get('Widget')).toBe(1);
  });

  it('多类名同文分别计数', () => {
    const tally = tallyConstructionSites('new A(); new B(); new A();\n');
    expect(tally.get('A')).toBe(2);
    expect(tally.get('B')).toBe(1);
  });
});

describe('reconcileConstructionSites', () => {
  it('计数一致 → 无漂移', () => {
    const { drift } = reconcileConstructionSites({
      markers: [{ className: 'Widget', expected: 2, includeTests: false }],
      countFor: () => 2,
    });
    expect(drift).toEqual([]);
  });

  it('计数不符 → 漂移点名类名/期望/实际', () => {
    const { drift } = reconcileConstructionSites({
      markers: [{ className: 'Widget', expected: 2, includeTests: false }],
      countFor: () => 5,
    });
    expect(drift).toEqual([{ className: 'Widget', expected: 2, actual: 5, includeTests: false }]);
  });

  it('countFor 收到标记的 includeTests 口径', () => {
    const seen: Array<[string, boolean]> = [];
    reconcileConstructionSites({
      markers: [
        { className: 'A', expected: 1, includeTests: false },
        { className: 'B', expected: 1, includeTests: true },
      ],
      countFor: (className, includeTests) => {
        seen.push([className, includeTests]);
        return 1;
      },
    });
    expect(seen).toEqual([
      ['A', false],
      ['B', true],
    ]);
  });

  it('多标记混合：只报不符的', () => {
    const { drift } = reconcileConstructionSites({
      markers: [
        { className: 'Ok', expected: 1, includeTests: false },
        { className: 'Bad', expected: 3, includeTests: false },
      ],
      countFor: (className) => (className === 'Ok' ? 1 : 0),
    });
    expect(drift).toEqual([{ className: 'Bad', expected: 3, actual: 0, includeTests: false }]);
  });

  it('空标记列表 → 零漂移且不碰 countFor', () => {
    const countFor = jest.fn(() => 0);
    const { drift } = reconcileConstructionSites({ markers: [], countFor });
    expect(drift).toEqual([]);
    expect(countFor).not.toHaveBeenCalled();
  });
});
