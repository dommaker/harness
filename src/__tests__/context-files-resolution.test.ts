/**
 * resolveContextFiles 三态访问器测试（工单 84）
 *
 * 测试面 = project-config-loader 上的 governance.context_files 访问器：
 * 未配置 / enabled 但无目标 / enabled 且非空 三态可分辨；访问器基于
 * loadRawProjectConfig 的进程级 memoize，不触发第二次 yaml 解析。
 * 临时目录由 src/test-setup/mkdtemp-cleanup.ts 统一回收。
 */

import { describe, it, expect, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { resolveContextFiles, loadRawProjectConfig } from '../core/project-config-loader';
import { createProjectFixture } from '../test-setup/project-fixture';

// ts-jest 的 namespace 导入属性不可重定义（jest.spyOn 会抛），改为只包一层
// readFileSync 的部分 mock——其余 fs 能力用真实实现，fixture 搭建不受影响。
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

const readSpy = (fs as unknown as { readFileSync: jest.Mock }).readFileSync;

function setupProject(name: string, configYml: string | null): string {
  return createProjectFixture({ name: `ctx-files-${name}`, config: configYml ?? undefined });
}

const CTX_FILES = (enabled: boolean, dirs?: string[]) =>
  `governance:\n  context_files:\n    enabled: ${enabled}\n` +
  (dirs ? `    required_dirs: [${dirs.map(d => `'${d}'`).join(', ')}]\n` : '');

describe('resolveContextFiles — 三态分辨率（工单 84 triage 裁决口径）', () => {
  it('无 config.yml → unconfigured', () => {
    expect(resolveContextFiles(setupProject('no-config', null))).toEqual({
      state: 'unconfigured',
    });
  });

  it('governance / context_files 段缺失 → unconfigured', () => {
    expect(resolveContextFiles(setupProject('no-section', 'preset: standard\n'))).toEqual({
      state: 'unconfigured',
    });
  });

  it('enabled: false → unconfigured（约定未采用，与段缺失同态）', () => {
    expect(resolveContextFiles(setupProject('disabled', CTX_FILES(false, ['src'])))).toEqual({
      state: 'unconfigured',
    });
  });

  it('enabled 但 required_dirs 缺失 / 非数组 / 空数组 → enabled-empty', () => {
    expect(resolveContextFiles(setupProject('no-dirs', CTX_FILES(true)))).toEqual({
      state: 'enabled-empty',
    });
    expect(
      resolveContextFiles(
        setupProject('bad-dirs', 'governance:\n  context_files:\n    enabled: true\n    required_dirs: src\n')
      )
    ).toEqual({ state: 'enabled-empty' });
    expect(resolveContextFiles(setupProject('empty-dirs', CTX_FILES(true, [])))).toEqual({
      state: 'enabled-empty',
    });
  });

  it('enabled 且 required_dirs 含非字符串项 → enabled-empty（脏配置目标不可用，不得流入 path.join 抛错）', () => {
    expect(
      resolveContextFiles(
        setupProject('dirty-dirs', 'governance:\n  context_files:\n    enabled: true\n    required_dirs: [1, null]\n')
      )
    ).toEqual({ state: 'enabled-empty' });
  });

  it('enabled 且 required_dirs 非空 → enabled + dirs', () => {
    expect(resolveContextFiles(setupProject('ok', CTX_FILES(true, ['src', 'bin'])))).toEqual({
      state: 'enabled',
      dirs: ['src', 'bin'],
    });
  });

  it('governance 段形状不符（null / 标量）→ unconfigured（钻取点形状守护）', () => {
    expect(resolveContextFiles(setupProject('null-gov', 'governance:\n'))).toEqual({
      state: 'unconfigured',
    });
    expect(resolveContextFiles(setupProject('scalar-gov', 'governance: context_files\n'))).toEqual({
      state: 'unconfigured',
    });
  });

  it('YAML 解析失败 → unconfigured（访问器不抛出，由调用方按未配置处理）', () => {
    expect(resolveContextFiles(setupProject('bad-yaml', 'governance: [\n  broken: {{\n'))).toEqual({
      state: 'unconfigured',
    });
  });
});

describe('resolveContextFiles — memoize 语义（工单 84：不引入第二次解析）', () => {
  it('访问器多次调用 + 直接读 raw 共享单次 config.yml 读取', () => {
    const dir = setupProject('memo', CTX_FILES(true, ['src']));
    const configReads = () =>
      readSpy.mock.calls.filter(call =>
        String(call[0]).endsWith(path.join('.harness', 'config.yml'))
      ).length;

    readSpy.mockClear();
    expect(configReads()).toBe(0); // 探针有效：fixture 搭建不读 config

    resolveContextFiles(dir);
    expect(configReads()).toBe(1); // 首次真读取+解析

    resolveContextFiles(dir);
    resolveContextFiles(dir);
    loadRawProjectConfig(dir);
    expect(configReads()).toBe(1); // 复用进程级 memoize，无第二次解析
  });
});
