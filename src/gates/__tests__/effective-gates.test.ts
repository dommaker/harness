/**
 * 生效门禁集测试（G1：config.yml order/enabled 裁剪，对齐 getEffectiveConstraints 模式）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getEffectiveGates } from '../effective-gates';

const DEFAULT_ORDER = ['acceptance', 'command', 'contract', 'performance', 'review', 'security'];

describe('getEffectiveGates', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gates-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(yamlText: string): void {
    const harnessDir = path.join(dir, '.harness');
    fs.mkdirSync(harnessDir, { recursive: true });
    fs.writeFileSync(path.join(harnessDir, 'config.yml'), yamlText);
  }

  it('无 config.yml → 6 门禁按默认 order', () => {
    expect(getEffectiveGates(dir).map(g => g.id)).toEqual(DEFAULT_ORDER);
  });

  it('gates.order 声明式重排：列出的按列表序，未列出的按默认序排后', () => {
    writeConfig('gates:\n  order:\n    - security\n    - review\n');
    expect(getEffectiveGates(dir).map(g => g.id)).toEqual([
      'security',
      'review',
      'acceptance',
      'command',
      'contract',
      'performance',
    ]);
  });

  it('gates.<id>.enabled:false 裁剪（与 getEffectiveConstraints 同款删除语义）', () => {
    writeConfig('gates:\n  review:\n    enabled: false\n');
    const ids = getEffectiveGates(dir).map(g => g.id);
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain('review');
  });

  it('order 与 enabled 组合：禁用胜出，其余按 order 重排', () => {
    writeConfig('gates:\n  order:\n    - security\n    - review\n  review:\n    enabled: false\n');
    expect(getEffectiveGates(dir).map(g => g.id)).toEqual([
      'security',
      'acceptance',
      'command',
      'contract',
      'performance',
    ]);
  });

  it('order 引用未注册门禁 → 抛错（闭环）', () => {
    writeConfig('gates:\n  order:\n    - nope\n');
    expect(() => getEffectiveGates(dir)).toThrow(/gates.order 引用了未注册的门禁 "nope"/);
  });

  it('enabled 段引用未注册门禁 → 抛错（闭环）', () => {
    writeConfig('gates:\n  nope:\n    enabled: false\n');
    expect(() => getEffectiveGates(dir)).toThrow(/gates.nope 引用了未注册的门禁/);
  });

  it('order 重复 id → 抛错', () => {
    writeConfig('gates:\n  order:\n    - review\n    - review\n');
    expect(() => getEffectiveGates(dir)).toThrow(/门禁 "review" 重复/);
  });

  it('enabled:true 不裁剪', () => {
    writeConfig('gates:\n  review:\n    enabled: true\n');
    expect(getEffectiveGates(dir).map(g => g.id)).toEqual(DEFAULT_ORDER);
  });
});
