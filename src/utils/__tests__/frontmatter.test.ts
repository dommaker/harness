/**
 * markdown frontmatter 解析/序列化正本测试（harness#89，架构评审 2026-09-02 候选10）
 *
 * 三种畸形输入（缺 frontmatter / 未闭合 / 空 meta）与 YAML 非法的走法在本文件显式固定，
 * 各消费方（store / migration / knowledge index / sdd index / ingest）只允许复用这套判定。
 */

import { splitFrontmatter, joinFrontmatter } from '../frontmatter';

describe('splitFrontmatter — 合法 frontmatter 块', () => {
  it('解析 meta + body：与 store/migration 既有写盘格式（---\\n<yaml>---\\n\\n<body>）互认', () => {
    const raw = '---\nid: DEC-001\ntype: decision\n---\n\nBody line\n';
    const result = splitFrontmatter(raw);
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.meta).toEqual({ id: 'DEC-001', type: 'decision' });
    expect(result.body).toBe('Body line\n');
  });

  it('闭合行之后无空行时正文原样保留', () => {
    const result = splitFrontmatter('---\na: 1\n---\nBody\n');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.body).toBe('Body\n');
  });

  it('只吃闭合后的一个空行（与 join 的 `---\\n\\n` 包裹严格对称）', () => {
    const result = splitFrontmatter('---\na: 1\n---\n\n\nBody\n');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.body).toBe('\nBody\n');
  });

  it('闭合行即文件末尾（无尾随换行）→ body 为空串，仍是合法块', () => {
    const result = splitFrontmatter('---\na: 1\n---');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.meta).toEqual({ a: 1 });
    expect(result.body).toBe('');
  });

  it('正文中的 --- 分隔线不被误吞：闭合取第一个独立 --- 行', () => {
    const result = splitFrontmatter('---\na: 1\n---\n\nx\n\n---\n\ny\n');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.meta).toEqual({ a: 1 });
    expect(result.body).toBe('x\n\n---\n\ny\n');
  });

  it('meta 内缩进的 --- 是块标量内容，不算闭合行', () => {
    const result = splitFrontmatter('---\nnote: |\n  ---\nb: 2\n---\nBody\n');
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.meta).toEqual({ note: '---\n', b: 2 });
    expect(result.body).toBe('Body\n');
  });

  it('闭合必须是整行：--- 后带内容的行（含 ---- 长分隔线）不作闭合', () => {
    const result = splitFrontmatter('---\na: 1\n---broken\n----\nBody\n');
    expect(result.state).toBe('malformed');
    if (result.state !== 'malformed') return;
    expect(result.reason).toBe('unterminated');
  });
});

describe('splitFrontmatter — 三种畸形输入 + YAML 非法（一处定义）', () => {
  it('缺 frontmatter：首行不是 --- → absent', () => {
    expect(splitFrontmatter('# Title\n\nBody\n')).toEqual({ state: 'absent' });
  });

  it('缺 frontmatter：首行 --- 之前还有空白 → absent（起点必须在偏移 0）', () => {
    expect(splitFrontmatter('\n---\na: 1\n---\nBody\n')).toEqual({ state: 'absent' });
  });

  it('空 meta：零宽元数据块 → absent（不承载信息，与收口前 store 丢条目的走法一致）', () => {
    expect(splitFrontmatter('---\n---\n\nBody\n')).toEqual({ state: 'absent' });
  });

  it('空 meta：仅空白行 → absent', () => {
    expect(splitFrontmatter('---\n\n \n---\nBody\n')).toEqual({ state: 'absent' });
  });

  it('未闭合：有开无闭 → malformed/unterminated', () => {
    const result = splitFrontmatter('---\nid: X\ntitle: Y\n');
    expect(result.state).toBe('malformed');
    if (result.state !== 'malformed') return;
    expect(result.reason).toBe('unterminated');
    expect(result.detail).toContain('---');
  });

  it('YAML 语法错误 → malformed/invalid-yaml，detail 可定位', () => {
    const result = splitFrontmatter('---\na: [1,\n---\nBody\n');
    expect(result.state).toBe('malformed');
    if (result.state !== 'malformed') return;
    expect(result.reason).toBe('invalid-yaml');
    expect(result.detail.length).toBeGreaterThan(0);
    expect(result.detail).not.toContain('\n');
  });

  it('meta 是标量而非 mapping → malformed/invalid-yaml（消费方禁止再写 meta.id 式钻取）', () => {
    const result = splitFrontmatter('---\njust a string\n---\nBody\n');
    expect(result.state).toBe('malformed');
    if (result.state !== 'malformed') return;
    expect(result.reason).toBe('invalid-yaml');
  });

  it('meta 是数组 → malformed/invalid-yaml', () => {
    const result = splitFrontmatter('---\n- a\n- b\n---\nBody\n');
    expect(result.state).toBe('malformed');
    if (result.state !== 'malformed') return;
    expect(result.reason).toBe('invalid-yaml');
  });

  it('meta 是显式 null（`~`）→ malformed/invalid-yaml（与空白 meta 的 absent 区分）', () => {
    const result = splitFrontmatter('---\n~\n---\nBody\n');
    expect(result.state).toBe('malformed');
    if (result.state !== 'malformed') return;
    expect(result.reason).toBe('invalid-yaml');
  });

  it('CRLF 文件不按 frontmatter 处理 → absent（与收口前各消费方一致，不新增解释）', () => {
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\nBody\r\n')).toEqual({ state: 'absent' });
  });
});

describe('joinFrontmatter', () => {
  it('包裹格式与收口前逐字一致：`---\\n` + yaml.dump + `---\\n\\n` + body', () => {
    expect(joinFrontmatter({ id: 'X' }, 'Body\n')).toBe('---\nid: X\n---\n\nBody\n');
  });

  it('空 body 也保留闭合后的空行分隔', () => {
    expect(joinFrontmatter({ a: 1 }, '')).toBe('---\na: 1\n---\n\n');
  });

  it('按传入对象的键序落盘：排序策略留在消费方（裁决：收格式不收字段排序）', () => {
    expect(joinFrontmatter({ b: 1, a: 2 }, '')).toBe('---\nb: 1\na: 2\n---\n\n');
  });

  it('dump 用 lineWidth 120：100 字符标量不折行（非 js-yaml 缺省 80）', () => {
    const joined = joinFrontmatter({ title: 'a'.repeat(100) }, '');
    expect(joined.split('\n')[1]).toBe(`title: ${'a'.repeat(100)}`);
  });

  it('dump 用 lineWidth 120：200 字符标量按 120 折行（非不折行）', () => {
    const joined = joinFrontmatter({ title: 'a'.repeat(200) }, '');
    expect(joined).toContain('title: >-\n');
  });
});

describe('join ↔ split 往返闭环（已落盘条目不产生 diff 噪声）', () => {
  const realisticMeta = {
    id: 'PIT-001',
    type: 'pitfall',
    title: '端口不匹配: 3001 -> "API" 的三种走法',
    maturity: 'verified',
    layer: 'system',
    created: '2026-05-28T00:00:00.000Z',
    lastReferenced: '',
    contributors: ['agent'],
    projects: [],
    tags: ['port', 'events'],
    applicablePhases: ['IMPLEMENT'],
    sourceReferences: [{ workflow: 'wf', timestamp: '2026-05-28T00:00:00.000Z' }],
    referencedBy: [],
    executionResults: [],
    consumptionMode: 'reference',
    origin: 'agent',
  };

  function roundTripIsStable(body: string): void {
    const first = joinFrontmatter(realisticMeta, body);
    const parsed = splitFrontmatter(first);
    expect(parsed.state).toBe('ok');
    if (parsed.state !== 'ok') return;
    expect(parsed.meta).toEqual(realisticMeta);
    expect(parsed.body).toBe(body);
    expect(joinFrontmatter(parsed.meta, parsed.body)).toBe(first);
  }

  it('真实条目 meta + 正文：join → split → join 字节稳定', () => {
    roundTripIsStable('根因：端口不一致。\n\n## 处置\n显式指定 API_PORT\n');
  });

  it('空正文稳定', () => {
    roundTripIsStable('');
  });

  it('正文首行即 --- 分隔线时稳定（不误吞、不重复包裹）', () => {
    roundTripIsStable('---\n\n附录\n');
  });

  it('正文含超长行时稳定', () => {
    roundTripIsStable(`${'x'.repeat(300)}\n`);
  });

  it('meta 含被 120 折行的长标量时往返仍字节稳定（load→save 无 diff 噪声）', () => {
    const meta = { ...realisticMeta, title: Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') };
    const first = joinFrontmatter(meta, 'Body\n');
    expect(first).toContain('title: >-\n');
    const parsed = splitFrontmatter(first);
    expect(parsed.state).toBe('ok');
    if (parsed.state !== 'ok') return;
    expect(parsed.meta).toEqual(meta);
    expect(joinFrontmatter(parsed.meta, parsed.body)).toBe(first);
  });
});
