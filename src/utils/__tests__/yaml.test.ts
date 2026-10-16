/**
 * yaml 内部收口直接单测（#207：js-yaml → yaml@2）
 *
 * 钉住与 js-yaml 口径的差异点：merge 键展开、空文档、时间戳标量、dump 行宽透传。
 * 全仓唯一 import 'yaml' 的模块是 ../yaml，调用方不允许直接依赖 yaml 包。
 */

import { load, dump } from '../yaml';

describe('load', () => {
  it('merge 键 << 展开为被合并 mapping（对齐 js-yaml 默认展开口径）', () => {
    expect(load('base: &b { enabled: true }\nderived: { <<: *b, note: x }')).toEqual({
      base: { enabled: true },
      derived: { enabled: true, note: 'x' },
    });
  });

  it('空文档返回 null（js-yaml 为 undefined，调用点均 null-safe）', () => {
    expect(load('')).toBeNull();
  });

  it('时间戳样式标量保留 string（yaml@2 不转 Date）', () => {
    const parsed = load('created: 2026-05-23') as Record<string, unknown>;
    expect(parsed.created).toBe('2026-05-23');
  });

  it('YAML 1.2 core：yes/no/on/off 按字符串解析（与 js-yaml 4 默认一致）', () => {
    expect(load('a: yes\nb: off')).toEqual({ a: 'yes', b: 'off' });
  });
});

describe('dump', () => {
  it('透传 lineWidth：100+ 字符标量在 lineWidth 120 下不折行', () => {
    const long = 'x'.repeat(130);
    expect(dump({ title: long }, { lineWidth: 120 })).toBe(`title: ${long}\n`);
  });

  it('透传 indent：嵌套 mapping 按指定缩进落盘', () => {
    expect(dump({ a: { b: 1 } }, { indent: 2 })).toBe('a:\n  b: 1\n');
  });

  it('默认调用不带 options 也能序列化', () => {
    expect(dump({ a: 1 })).toBe('a: 1\n');
  });
});
