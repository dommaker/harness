/**
 * required_dirs 标记段公共读写（下游配置公共化）
 *
 * readRequiredDirs / updateRequiredDirs / checkRequiredDirs 三个公共接口，
 * 把消费方「AUTO-GENERATED:required_dirs 标记段」的段编辑能力收进 harness：
 * - 段外内容与注释逐字节保留；
 * - 缺标记 / 标记顺序错误抛 RequiredDirsMarkerError；
 * - check 全程零写盘。
 *
 * 使用真实临时目录。
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  readRequiredDirs,
  updateRequiredDirs,
  checkRequiredDirs,
  RequiredDirsMarkerError,
} from '../required-dirs';
import { createProjectFixture, writeProjectConfig } from '../../test-setup/project-fixture';

const HEADER = [
  '# harness 配置（项目自有注释，不得丢）',
  'harness:',
  '  version: 5.0.0',
  '',
  'governance:',
  '  context_files:',
  '    # 手写注释行（段外，须原样保留）',
  '    # AUTO-GENERATED:required_dirs',
].join('\n');

const FOOTER = [
  '    # /AUTO-GENERATED:required_dirs',
  '',
  '# 尾部注释（段外，须原样保留）',
].join('\n');

function configWith(dirs: string[]): string {
  const list = dirs.length > 0
    ? dirs.map(d => `      - ${d}`).join('\n') + '\n'
    : '';
  return `${HEADER}\n    required_dirs:\n${list}${FOOTER}\n`;
}

function configPath(root: string): string {
  return path.join(root, '.harness', 'config.yml');
}

function fixtureWith(content: string): string {
  return createProjectFixture({ name: 'harness-required-dirs', config: content });
}

describe('readRequiredDirs', () => {
  it('读出标记段内的清单（段外内容与注释不读不碰）', () => {
    const root = fixtureWith(configWith(['packages/a/src', 'apps/api/src/modules/x']));

    const result = readRequiredDirs(root);

    expect(result.targetPath).toBe(configPath(root));
    expect(result.dirs).toEqual(['packages/a/src', 'apps/api/src/modules/x']);
    // 只读：磁盘内容原样
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe(configWith(['packages/a/src', 'apps/api/src/modules/x']));
  });

  it('标记段内清单为空 → dirs 为空数组', () => {
    const root = fixtureWith(configWith([]));
    expect(readRequiredDirs(root).dirs).toEqual([]);
  });

  it('配置缺失 → 抛 RequiredDirsMarkerError', () => {
    const root = createProjectFixture({ name: 'harness-required-dirs' });
    expect(() => readRequiredDirs(root)).toThrow(RequiredDirsMarkerError);
  });

  it('缺 begin / 缺 end / end 在 begin 前 → 抛 RequiredDirsMarkerError', () => {
    const noBegin = createProjectFixture({ name: 'harness-required-dirs', config: 'harness:\n  version: 5.0.0\n' });
    expect(() => readRequiredDirs(noBegin)).toThrow(RequiredDirsMarkerError);

    const noEnd = createProjectFixture({
      name: 'harness-required-dirs',
      config: '# AUTO-GENERATED:required_dirs\n    required_dirs:\n',
    });
    expect(() => readRequiredDirs(noEnd)).toThrow(RequiredDirsMarkerError);

    const reversed = createProjectFixture({
      name: 'harness-required-dirs',
      config: '# /AUTO-GENERATED:required_dirs\n# AUTO-GENERATED:required_dirs\n',
    });
    expect(() => readRequiredDirs(reversed)).toThrow(RequiredDirsMarkerError);
  });
});

describe('updateRequiredDirs', () => {
  it('重写标记段：段外字节（含注释与空行）逐字节保留', () => {
    const before = configWith(['old/dir']);
    const root = fixtureWith(before);

    const result = updateRequiredDirs(root, ['packages/a/src', 'packages/b/src']);

    expect(result.changed).toBe(true);
    expect(result.dirs).toEqual(['packages/a/src', 'packages/b/src']);

    const after = fs.readFileSync(configPath(root), 'utf-8');
    expect(after).toBe(configWith(['packages/a/src', 'packages/b/src']));
    // 段外两段与原件逐字节一致
    expect(after.startsWith(HEADER + '\n')).toBe(true);
    expect(after.endsWith(FOOTER + '\n')).toBe(true);
  });

  it('幂等：清单已是最新 → changed:false 且零写盘（mtime 不动）', () => {
    const root = fixtureWith(configWith(['packages/a/src']));
    const beforeMtime = fs.statSync(configPath(root)).mtimeMs;
    const beforeContent = fs.readFileSync(configPath(root), 'utf-8');

    const result = updateRequiredDirs(root, ['packages/a/src']);

    expect(result.changed).toBe(false);
    expect(fs.statSync(configPath(root)).mtimeMs).toBe(beforeMtime);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe(beforeContent);
  });

  it('沿用既有 required_dirs 行的缩进（段内缩进不硬编码四空格）', () => {
    const content = [
      'governance:',
      '  context_files:',
      '      # AUTO-GENERATED:required_dirs',
      '      required_dirs:',
      '        - deep/dir',
      '      # /AUTO-GENERATED:required_dirs',
      '',
    ].join('\n');
    const root = fixtureWith(content);

    updateRequiredDirs(root, ['deep/other']);

    const after = fs.readFileSync(configPath(root), 'utf-8');
    expect(after).toBe([
      'governance:',
      '  context_files:',
      '      # AUTO-GENERATED:required_dirs',
      '      required_dirs:',
      '        - deep/other',
      '      # /AUTO-GENERATED:required_dirs',
      '',
    ].join('\n'));
  });

  it('缺标记 / 标记顺序错误 → 抛 RequiredDirsMarkerError，零写盘', () => {
    const root = createProjectFixture({ name: 'harness-required-dirs', config: 'harness:\n  version: 5.0.0\n' });
    expect(() => updateRequiredDirs(root, ['a'])).toThrow(RequiredDirsMarkerError);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe('harness:\n  version: 5.0.0\n');
  });

  it('配置缺失 → 抛 RequiredDirsMarkerError', () => {
    const root = createProjectFixture({ name: 'harness-required-dirs' });
    expect(() => updateRequiredDirs(root, ['a'])).toThrow(RequiredDirsMarkerError);
  });
});

describe('checkRequiredDirs', () => {
  it('清单已是最新 → matches:true，零写盘', () => {
    const root = fixtureWith(configWith(['packages/a/src']));
    const beforeMtime = fs.statSync(configPath(root)).mtimeMs;

    const result = checkRequiredDirs(root, ['packages/a/src']);

    expect(result.matches).toBe(true);
    expect(result.actual).toEqual(['packages/a/src']);
    expect(result.expected).toEqual(['packages/a/src']);
    expect(fs.statSync(configPath(root)).mtimeMs).toBe(beforeMtime);
  });

  it('清单漂移 → matches:false 且零写盘（CI 漂移门形态）', () => {
    const root = fixtureWith(configWith(['old/dir']));
    const beforeContent = fs.readFileSync(configPath(root), 'utf-8');

    const result = checkRequiredDirs(root, ['new/dir']);

    expect(result.matches).toBe(false);
    expect(result.actual).toEqual(['old/dir']);
    expect(result.expected).toEqual(['new/dir']);
    expect(fs.readFileSync(configPath(root), 'utf-8')).toBe(beforeContent);
  });

  it('配置缺失 → matches:false（漂移），不创建文件', () => {
    const root = createProjectFixture({ name: 'harness-required-dirs' });
    const result = checkRequiredDirs(root, ['a']);
    expect(result.matches).toBe(false);
    expect(result.actual).toEqual([]);
    expect(fs.existsSync(configPath(root))).toBe(false);
  });

  it('标记损坏 → 抛 RequiredDirsMarkerError', () => {
    const root = createProjectFixture({ name: 'harness-required-dirs', config: 'harness:\n  version: 5.0.0\n' });
    expect(() => checkRequiredDirs(root, ['a'])).toThrow(RequiredDirsMarkerError);
  });
});

describe('写后读回（经 writeProjectConfig 换内容模拟漂移再生）', () => {
  it('update → read 一致；update → check 一致', () => {
    const root = createProjectFixture({ name: 'harness-required-dirs' });
    writeProjectConfig(root, configWith(['a']));

    updateRequiredDirs(root, ['x', 'y']);
    expect(readRequiredDirs(root).dirs).toEqual(['x', 'y']);
    expect(checkRequiredDirs(root, ['x', 'y']).matches).toBe(true);
    expect(checkRequiredDirs(root, ['x']).matches).toBe(false);
  });
});
