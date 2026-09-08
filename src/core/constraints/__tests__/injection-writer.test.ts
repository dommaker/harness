/**
 * injection-writer 旁测（架构评审候选1，ADR-0011）
 *
 * 测试面 = 纯函数（字符串进、字符串出）+ 落点路由（真实 fs 临时目录）。
 * 幂等/半标记守护/两种尾部形状/读写路由优先级全部在此测一次；
 * 消费方（init/retire/drift）只测各自语义（init-injection.test 行为面）。
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  replaceStandaloneRange,
  replaceEnclosedRange,
  cutMarkerBlock,
  resolveInjectionTarget,
  resolveGovernanceLanding,
  GOVERNANCE_HEADING,
  hasGovernanceContract,
  countGovernanceHeadings,
  hasPreserveBlock,
} from '../injection-writer';
import {
  CONSTRAINTS_START_MARKER as CS,
  CONSTRAINTS_END_MARKER as CE,
} from '../injection-renderer';

const B = '<!-- B -->';
const E = '<!-- E -->';

describe('replaceStandaloneRange — 独立成节形状', () => {
  it('替换含标记区间；尾文多换行折叠为恰好一个空行', () => {
    const content = `head\n${B}\nold\n${E}\n\n\n\nrest\n`;
    const r = replaceStandaloneRange(content, B, E, `${B}\nnew\n${E}\n`);
    expect(r).toEqual({ kind: 'updated', content: `head\n${B}\nnew\n${E}\n\nrest\n` });
  });

  it('尾文恰好一个空行分隔（含原本无多余换行时）', () => {
    const content = `${B}\nold\n${E}\nrest\n`;
    const r = replaceStandaloneRange(content, B, E, `${B}\nnew\n${E}\n`);
    expect(r).toEqual({ kind: 'updated', content: `${B}\nnew\n${E}\n\nrest\n` });
  });

  it('区间在文件末尾：不产生尾空行', () => {
    const content = `head\n${B}\nold\n${E}\n`;
    const r = replaceStandaloneRange(content, B, E, `${B}\nnew\n${E}\n`);
    expect(r).toEqual({ kind: 'updated', content: `head\n${B}\nnew\n${E}\n` });
  });

  it('幂等：重复替换结果不动点', () => {
    const once = replaceStandaloneRange(`a\n${B}\nx\n${E}\n\n\nb\n`, B, E, `${B}\nnew\n${E}\n`);
    expect(once.kind).toBe('updated');
    const twice = replaceStandaloneRange((once as { content: string }).content, B, E, `${B}\nnew\n${E}\n`);
    expect(twice).toEqual(once);
  });

  it('两俱无 → absent；单边/乱序 → half（拒写）', () => {
    expect(replaceStandaloneRange('nothing here', B, E, 'x')).toEqual({ kind: 'absent' });
    expect(replaceStandaloneRange(`${B}\norphan`, B, E, 'x')).toEqual({ kind: 'half' });
    expect(replaceStandaloneRange(`orphan ${E}`, B, E, 'x')).toEqual({ kind: 'half' });
    expect(replaceStandaloneRange(`${E}\n...\n${B}`, B, E, 'x')).toEqual({ kind: 'half' });
  });
});

describe('replaceEnclosedRange — 外层收口紧随形状', () => {
  it('恰好剥一个前导换行，手写余文的额外换行原样保留', () => {
    const inner = `\n## H\n${CS}\nold\n${CE}\n\n手写余文\n`;
    const r = replaceEnclosedRange(inner, CS, CE, `${CS}\nnew\n${CE}\n`);
    expect(r).toEqual({ kind: 'updated', content: `\n## H\n${CS}\nnew\n${CE}\n\n手写余文\n` });
  });

  it('区间后仅有行尾换行（收口标记直接落行）', () => {
    const inner = `\n${CS}\nold\n${CE}\n`;
    const r = replaceEnclosedRange(inner, CS, CE, `${CS}\nnew\n${CE}\n`);
    expect(r).toEqual({ kind: 'updated', content: `\n${CS}\nnew\n${CE}\n` });
  });

  it('absent → 调用方走追加；half → 拒写', () => {
    expect(replaceEnclosedRange('\n纯手写段\n', CS, CE, 'x')).toEqual({ kind: 'absent' });
    expect(replaceEnclosedRange(`${CS}orphan`, CS, CE, 'x')).toEqual({ kind: 'half' });
  });
});

describe('cutMarkerBlock', () => {
  it('切出 before/inner/after 三段，inner 含首尾标记行间全部文本', () => {
    const content = `before\n${B}\ninner-body\n${E}\nafter\n`;
    expect(cutMarkerBlock(content, B, E)).toEqual({
      before: 'before\n',
      inner: '\ninner-body\n',
      after: '\nafter\n',
    });
  });

  it('absent / half 与替换函数同一判定', () => {
    expect(cutMarkerBlock('clean', B, E)).toBe('absent');
    expect(cutMarkerBlock(`${B} only`, B, E)).toBe('half');
  });
});

describe('落点路由（读写两侧，studio #307/#302）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(process.cwd(), 'temp-test-inj-writer-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, content: string) =>
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');

  it('resolveInjectionTarget：CLAUDE.md 完整标记段优先于 AGENTS.md', () => {
    write('CLAUDE.md', `x\n${CS}\nbody\n${CE}\n`);
    write('AGENTS.md', `<!-- PRESERVE:governance -->\n${CS}\nbody2\n${CE}\n`);
    expect(resolveInjectionTarget(dir)?.file).toBe('CLAUDE.md');
  });

  it('CLAUDE.md 标记残缺（单边）不算落点 → 落 AGENTS.md', () => {
    write('CLAUDE.md', `x\n${CS}\nbroken\n`);
    write('AGENTS.md', `${CS}\nbody\n${CE}\n`);
    expect(resolveInjectionTarget(dir)?.file).toBe('AGENTS.md');
  });

  it('两处均无完整标记段 → null（未注入）', () => {
    write('CLAUDE.md', '# 无约束标记\n');
    expect(resolveInjectionTarget(dir)).toBeNull();
  });

  it('resolveGovernanceLanding：CLAUDE.md 有标记或有旧版 Governance Rules 块 → claude-md', () => {
    write('CLAUDE.md', `${CS}\nbody\n${CE}\n`);
    expect(resolveGovernanceLanding(dir).target).toBe('claude-md');
    write('CLAUDE.md', '# CLAUDE.md\n\n## Governance Rules\n\n手写\n');
    expect(resolveGovernanceLanding(dir).target).toBe('claude-md');
  });

  it('CLAUDE.md 与治理无关 / 不存在 → agents-md', () => {
    write('CLAUDE.md', '# CLAUDE.md\n\n@AGENTS.md\n');
    expect(resolveGovernanceLanding(dir).target).toBe('agents-md');
    fs.rmSync(path.join(dir, 'CLAUDE.md'));
    expect(resolveGovernanceLanding(dir).target).toBe('agents-md');
  });

  it('落点路由消费共享宽松谓词：双空格标题变体也路由 claude-md（fail-open）', () => {
    write('CLAUDE.md', '# CLAUDE.md\n\n##  Governance Rules\n\n手写\n');
    expect(resolveGovernanceLanding(dir).target).toBe('claude-md');
  });
});

describe('治理契约探测共享符号（#83，ADR-0011 补注：收口范围含探测器）', () => {
  it('GOVERNANCE_HEADING 是标题字面量单一来源', () => {
    expect(GOVERNANCE_HEADING).toBe('## Governance Rules');
  });

  describe('hasGovernanceContract — 宽松谓词（有无契约，fail-open）', () => {
    it('精确标题 → true', () => {
      expect(hasGovernanceContract('# doc\n\n## Governance Rules\n\n条款\n')).toBe(true);
    });

    it('双空格标题变体 → true（宁可信其有）', () => {
      expect(hasGovernanceContract('# doc\n\n##  Governance Rules\n\n条款\n')).toBe(true);
    });

    it('HARNESS 约束标记在场 → true（完整注释壳与裸文本皆认）', () => {
      expect(hasGovernanceContract('<!-- HARNESS_CONSTRAINTS_START -->\nx\n')).toBe(true);
      expect(hasGovernanceContract('HARNESS_CONSTRAINTS_START\nx\n')).toBe(true);
    });

    it('两样皆无 → false', () => {
      expect(hasGovernanceContract('# CLAUDE.md\n\n@AGENTS.md\n')).toBe(false);
    });
  });

  describe('countGovernanceHeadings — 严格计数（正本标题，行尾锚定）', () => {
    it('精确拼写逐个计数', () => {
      expect(countGovernanceHeadings('## Governance Rules\n')).toBe(1);
      expect(countGovernanceHeadings('## Governance Rules\n甲\n\n## Governance Rules\n乙\n')).toBe(2);
    });

    it('行尾空白容忍', () => {
      expect(countGovernanceHeadings('## Governance Rules  \n')).toBe(1);
      expect(countGovernanceHeadings('## Governance Rules\t\n')).toBe(1);
    });

    it('宽松变体不计入：双空格 / 三级标题 / 行中嵌入 → 0', () => {
      expect(countGovernanceHeadings('##  Governance Rules\n')).toBe(0);
      expect(countGovernanceHeadings('### Governance Rules\n')).toBe(0);
      expect(countGovernanceHeadings('前文 ## Governance Rules 行中\n')).toBe(0);
    });
  });

  describe('hasPreserveBlock — PRESERVE 块存在性 + 块体非空', () => {
    const begin = '<!-- PRESERVE:governance -->';
    const end = '<!-- /PRESERVE:governance -->';

    it('块体非空 + 首尾标记独占一行 → true', () => {
      expect(hasPreserveBlock(`# t\n${begin}\n## H\n条款\n${end}\n`, 'governance')).toBe(true);
    });

    it('块体仅空白 → false（被掏空）', () => {
      expect(hasPreserveBlock(`${begin}\n   \n${end}\n`, 'governance')).toBe(false);
      expect(hasPreserveBlock(`${begin}\n\n${end}\n`, 'governance')).toBe(false);
    });

    it('结束标记嵌在行中 = 畸形块 → false（显式收紧，#83）', () => {
      expect(hasPreserveBlock(`${begin}\n条款 <!-- /PRESERVE:governance --> 尾注\n`, 'governance')).toBe(false);
    });

    it('结束标记缺失 / 乱序 → false', () => {
      expect(hasPreserveBlock(`${begin}\n条款\n`, 'governance')).toBe(false);
      expect(hasPreserveBlock(`${end}\n${begin}\n`, 'governance')).toBe(false);
    });

    it('开始标记不在 / 名称不符 → false', () => {
      expect(hasPreserveBlock('没有标记\n', 'governance')).toBe(false);
      expect(hasPreserveBlock(`${begin}\n条款\n${end}\n`, 'other')).toBe(false);
    });

    it('标记行行尾空白容忍（独占一行语义）', () => {
      expect(hasPreserveBlock(`${begin}  \n条款\n${end}  \n`, 'governance')).toBe(true);
    });
  });

  it('一致性 fixture：双空格 → 宽松在场 true 且严格计数 0；精确拼写 → 两者均认', () => {
    const variant = '# CLAUDE.md\n\n##  Governance Rules\n\n条款\n';
    expect(hasGovernanceContract(variant)).toBe(true);
    expect(countGovernanceHeadings(variant)).toBe(0);

    const exact = '# CLAUDE.md\n\n## Governance Rules\n\n条款\n';
    expect(hasGovernanceContract(exact)).toBe(true);
    expect(countGovernanceHeadings(exact)).toBe(1);
  });
});
