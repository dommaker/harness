/**
 * project-fixture 构造 API 测试（架构评审 2026-09-02 候选11 / harness#90）
 *
 * 钉死三条契约：
 * 1) 缺省根 = os.tmpdir()，`config` 槽位逐字节落 `.harness/config.yml`（不做 YAML 往返——
 *    被检代码大量用例是畸形/脏配置，原样落盘是硬需求）；
 * 2) 非缺省根必须经 parentDir **显式**声明（cwd 锚定用例的前置约束，不隐式继承默认根）；
 * 3) 建出的根由 mkdtemp 劫持登记 = 用例结束自动清理，且 name 形状可被超龄兜底清扫识别。
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProjectFixture, writeProjectConfig } from '../project-fixture';
import { isRegisteredTmpDir } from '../mkdtemp-cleanup';

/** mkdtemp-cleanup.ts 的超龄清扫签名（name 不合规的夹具目录漏网后永不被扫） */
const SWEEP_SIGNATURE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-[A-Za-z0-9]{6}$/;

describe('createProjectFixture — 根与 config 槽位', () => {
  it('缺省根在 os.tmpdir()，config 逐字节落 .harness/config.yml', () => {
    const root = createProjectFixture({ name: 'pfx-default', config: 'preset: standard\n' });

    expect(path.dirname(root)).toBe(os.tmpdir());
    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe('preset: standard\n');
  });

  it('省略 config → 不写 .harness/config.yml（存在性探测类用例依赖此语义）', () => {
    const root = createProjectFixture({ name: 'pfx-no-config' });

    expect(fs.existsSync(path.join(root, '.harness', 'config.yml'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('config 为空字符串仍算声明（falsy 不得退化为“不写”）', () => {
    const root = createProjectFixture({ name: 'pfx-empty-config', config: '' });

    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe('');
  });

  it('files 按相对路径落盘，父目录自动创建', () => {
    const root = createProjectFixture({
      name: 'pfx-files',
      files: {
        'src/core/foo.ts': 'export const x = 1;',
        'src/CONTEXT.md': '# src\n',
        '.harness/custom-constraints.yml': 'custom_constraints: {}\n',
      },
    });

    expect(fs.readFileSync(path.join(root, 'src/core/foo.ts'), 'utf-8')).toBe('export const x = 1;');
    expect(fs.readFileSync(path.join(root, 'src/CONTEXT.md'), 'utf-8')).toBe('# src\n');
    // 通用槽位不得踩 config 正本路径：两者共存时各写各的
    expect(fs.readFileSync(path.join(root, '.harness/custom-constraints.yml'), 'utf-8')).toBe(
      'custom_constraints: {}\n'
    );
    expect(fs.existsSync(path.join(root, '.harness/config.yml'))).toBe(false);
  });

  it('config 与 files 同时声明 → 两侧都落盘', () => {
    const root = createProjectFixture({
      name: 'pfx-both',
      config: 'preset: relaxed\n',
      files: { 'CAPABILITIES.md': '# Capabilities\n' },
    });

    expect(fs.readFileSync(path.join(root, '.harness/config.yml'), 'utf-8')).toBe('preset: relaxed\n');
    expect(fs.readFileSync(path.join(root, 'CAPABILITIES.md'), 'utf-8')).toBe('# Capabilities\n');
  });
});

describe('createProjectFixture — 显式 opt-out 根', () => {
  it('parentDir 声明的根落在该父目录下，而非缺省 tmpdir', () => {
    const parent = createProjectFixture({ name: 'pfx-parent' });
    const root = createProjectFixture({ name: 'pfx-child', parentDir: parent });

    expect(path.dirname(root)).toBe(parent);
    expect(root.startsWith(path.join(parent, 'pfx-child-'))).toBe(true);
  });

  it('parentDir: process.cwd() → 根落在仓库工作目录（cwd 锚定套件依赖的正是这条语义）', () => {
    const root = createProjectFixture({ name: 'pfx-cwd-anchor', parentDir: process.cwd() });
    try {
      expect(path.dirname(root)).toBe(process.cwd());
      expect(fs.existsSync(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('opt-out 用例仍被 mkdtemp 劫持登记（自动清理不依赖调用方手动 rm）', () => {
    const parent = createProjectFixture({ name: 'pfx-optout-parent' });
    const root = createProjectFixture({ name: 'pfx-optout-child', parentDir: parent });

    expect(isRegisteredTmpDir(root)).toBe(true);
  });

  it('缺省根同样登记，且目录名符合超龄清扫签名（漏网目录可被兜底扫掉）', () => {
    const root = createProjectFixture({ name: 'pfx-sweepable' });

    expect(isRegisteredTmpDir(root)).toBe(true);
    expect(SWEEP_SIGNATURE.test(path.basename(root))).toBe(true);
  });

  it('name 形状不合规（大写/下划线/空）→ 抛错，不静默产出扫不掉的目录', () => {
    expect(() => createProjectFixture({ name: 'Pfx-Bad' })).toThrow(/name/);
    expect(() => createProjectFixture({ name: 'pfx_bad' })).toThrow(/name/);
    expect(() => createProjectFixture({ name: '' })).toThrow(/name/);
  });
});

describe('writeProjectConfig — config 落盘唯一正本', () => {
  it('根下无 .harness 时自动建目录并写入', () => {
    const root = createProjectFixture({ name: 'pfx-writer' });

    writeProjectConfig(root, 'gates:\n  order:\n    - security\n');

    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe(
      'gates:\n  order:\n    - security\n'
    );
  });

  it('已有 config 时覆盖写（用例内后续改配置不叠加旧内容）', () => {
    const root = createProjectFixture({ name: 'pfx-rewrite', config: 'preset: standard\n' });

    writeProjectConfig(root, 'preset: relaxed\n');

    expect(fs.readFileSync(path.join(root, '.harness', 'config.yml'), 'utf-8')).toBe('preset: relaxed\n');
  });
});
