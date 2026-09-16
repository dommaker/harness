/**
 * 数值旗帜装配解析器测试（harness#154）
 *
 * 口径正本：src/cli/commands/CONTEXT.md「数值旗帜装配口径（harness#152）」条目——
 * commander 给到命令侧恒是字符串、数值只在装配点转一次、转不出来 fail-loud。
 * 本模块是全部数值旗帜的唯一解析器：定义表 mapActionArgs 走 requireNumericFlag（抛
 * NumericFlagError，bin 映射 usage-error），命令模块入口走 parseNumericFlag（返回值
 * 判别，就地 logError + usage-error）。
 */

import {
  NumericFlagError,
  numericFlagMessage,
  parseNumericFlag,
  requireNumericFlag,
} from '../numeric-flag';

describe('parseNumericFlag：int 形', () => {
  it('合法：十进制整数字符串 → 数值；undefined → 未传（落下游缺省）', () => {
    expect(parseNumericFlag('20', 'int')).toEqual({ ok: true, value: 20 });
    expect(parseNumericFlag(' 7 ', 'int')).toEqual({ ok: true, value: 7 });
    expect(parseNumericFlag(undefined, 'int')).toEqual({ ok: true });
  });

  it('显式 "0" 是合法零值，不当「未传」兜掉', () => {
    expect(parseNumericFlag('0', 'int')).toEqual({ ok: true, value: 0 });
  });

  it.each(['abc', '30abc', '1e2', '0.7', '-5', '', ' ', 'NaN', 'Infinity', '0x10'])(
    '脏输入 %o → ok:false（parseInt 会静默误读的形一并拒）',
    (raw) => {
      expect(parseNumericFlag(raw, 'int')).toEqual({ ok: false, raw });
    },
  );

  it('数值溢出（位数字符串超 double 上限）→ ok:false，不放 Infinity 进判定槽', () => {
    const raw = '9'.repeat(400);
    expect(parseNumericFlag(raw, 'int')).toEqual({ ok: false, raw });
  });
});

describe('parseNumericFlag：float 形', () => {
  it('合法：整数与小数字符串 → 数值', () => {
    expect(parseNumericFlag('0.8', 'float')).toEqual({ ok: true, value: 0.8 });
    expect(parseNumericFlag('1', 'float')).toEqual({ ok: true, value: 1 });
    expect(parseNumericFlag('0', 'float')).toEqual({ ok: true, value: 0 });
  });

  it.each(['abc', '0.8.1', '1.', '.5', '1e-3', '-0.5', '', 'NaN', 'Infinity'])(
    '脏输入 %o → ok:false',
    (raw) => {
      expect(parseNumericFlag(raw, 'float')).toEqual({ ok: false, raw });
    },
  );
});

describe('numericFlagMessage / requireNumericFlag', () => {
  it('报错文案点名旗帜与原值（可定位）', () => {
    expect(numericFlagMessage('--limit', 'abc', 'int')).toBe('错误：--limit 需要非负整数，收到 "abc"');
    expect(numericFlagMessage('--noise-fail-rate', 'x', 'float')).toBe('错误：--noise-fail-rate 需要非负数值，收到 "x"');
  });

  it('合法值原样返回；未传 → undefined', () => {
    expect(requireNumericFlag('--limit', '20', 'int')).toBe(20);
    expect(requireNumericFlag('--limit', '0', 'int')).toBe(0);
    expect(requireNumericFlag('--limit', undefined, 'int')).toBeUndefined();
  });

  it('脏输入抛 NumericFlagError（bin 据 name/instanceof 映射 usage-error）', () => {
    let caught: unknown;
    try {
      requireNumericFlag('--zero-intercept-min', 'abc', 'int');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NumericFlagError);
    expect((caught as Error).name).toBe('NumericFlagError');
    expect((caught as Error).message).toBe('错误：--zero-intercept-min 需要非负整数，收到 "abc"');
  });
});
