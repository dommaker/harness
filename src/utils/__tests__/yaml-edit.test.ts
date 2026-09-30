/**
 * yaml-edit 直接单测（setYamlEntry / removeYamlEntry 自 constraints-retire 抽出后的旁测；
 * 命令级端到端覆盖见 commands/__tests__/constraints-retire.test.ts 的逐字节冻结用例）
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { describe, it, expect, afterAll } from '@jest/globals';
import { setYamlEntry, removeYamlEntry } from '../yaml-edit';

const dir = mkdtempSync(join(tmpdir(), 'harness-yaml-edit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function target(name: string): string {
  return join(dir, name);
}

describe('setYamlEntry', () => {
  it('文件不存在时创建（含父目录），写入 section.id 补丁', () => {
    const file = target('nested/config.yml');
    setYamlEntry(file, 'config.yml', 'constraints', 'no_foo', { enabled: false });
    const raw = yaml.load(readFileSync(file, 'utf-8')) as Record<string, Record<string, unknown>>;
    expect(raw.constraints.no_foo).toEqual({ enabled: false });
  });

  it('已有条目合并补丁，不动其他键', () => {
    const file = target('merge.yml');
    writeFileSync(file, yaml.dump({ constraints: { a: { enabled: false, note: 'keep' }, b: { enabled: true } } }));
    setYamlEntry(file, 'merge.yml', 'constraints', 'a', { retired: { at: 'x' } });
    const raw = yaml.load(readFileSync(file, 'utf-8')) as Record<string, Record<string, Record<string, unknown>>>;
    expect(raw.constraints.a).toEqual({ enabled: false, note: 'keep', retired: { at: 'x' } });
    expect(raw.constraints.b).toEqual({ enabled: true });
  });
});

describe('removeYamlEntry', () => {
  it('删除 section.id 并返回 true', () => {
    const file = target('remove.yml');
    writeFileSync(file, yaml.dump({ constraints: { a: { enabled: false }, b: {} } }));
    expect(removeYamlEntry(file, 'constraints', 'a')).toBe(true);
    const raw = yaml.load(readFileSync(file, 'utf-8')) as Record<string, Record<string, unknown>>;
    expect('a' in raw.constraints).toBe(false);
    expect('b' in raw.constraints).toBe(true);
  });

  it('文件不存在 → false 且不创建文件', () => {
    const file = target('nonexistent.yml');
    expect(removeYamlEntry(file, 'constraints', 'a')).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('条目不存在 → false 且零写盘（mtime 不变）', async () => {
    const file = target('noop.yml');
    writeFileSync(file, yaml.dump({ constraints: { b: {} } }));
    const before = statSync(file).mtimeMs;
    await new Promise(r => setTimeout(r, 10));
    expect(removeYamlEntry(file, 'constraints', 'missing')).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });
});
