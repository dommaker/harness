/**
 * propagateConfig / HARNESS_CONFIG_FILES（harness#198）
 *
 * 「哪些文件算 harness 配置」这一知识在库内只有单一主人（HARNESS_CONFIG_FILES，
 * 当前 = config.yml + checkpoints.yml）；propagateConfig 把它从源目录铺到目标目录，
 * 下游消费方（如 worktree 装配器）不再手工 cp。不做 hooks/CI/CONTEXT.md 那套
 * 完整 init。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { HARNESS_CONFIG_FILES, propagateConfig } from '../config-files';
import { getEffectiveConstraints } from '../effective-constraints';

const CONFIG_YML = 'constraints:\n  capability_sync:\n    enabled: false\n';
const CHECKPOINTS_YML = 'checkpoints: []\n';

let src: string;
let dst: string;

beforeEach(() => {
  src = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-propagate-src-'));
  dst = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-propagate-dst-'));
});

afterEach(() => {
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(dst, { recursive: true, force: true });
});

function writeSrc(rel: string, content: string): void {
  const file = path.join(src, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

describe('propagateConfig', () => {
  it('铺放 config.yml + checkpoints.yml（逐字节一致），返回实际铺放的相对路径', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);
    writeSrc(path.join('.harness', 'checkpoints.yml'), CHECKPOINTS_YML);

    const copied = propagateConfig(src, dst);

    expect(copied.sort()).toEqual([...HARNESS_CONFIG_FILES].sort());
    expect(fs.readFileSync(path.join(dst, '.harness', 'config.yml'), 'utf-8')).toBe(CONFIG_YML);
    expect(fs.readFileSync(path.join(dst, '.harness', 'checkpoints.yml'), 'utf-8')).toBe(CHECKPOINTS_YML);
    // 铺放后的 checkpoints.yml 是可解析的 harness 检查点文件
    expect(yaml.load(fs.readFileSync(path.join(dst, '.harness', 'checkpoints.yml'), 'utf-8'))).toEqual({ checkpoints: [] });
  });

  it('铺放后的目标目录可直接跑 check 的配置读路径（生效集按 config.yml 收敛）', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);
    writeSrc(path.join('.harness', 'checkpoints.yml'), CHECKPOINTS_YML);

    propagateConfig(src, dst);

    const effective = getEffectiveConstraints(dst);
    expect(effective.some(c => c.id === 'capability_sync')).toBe(false);
    expect(effective.length).toBeGreaterThan(0);
  });

  it('源缺失的文件跳过不造：只铺放存在的，返回清单如实', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);

    const copied = propagateConfig(src, dst);

    expect(copied).toEqual([path.join('.harness', 'config.yml')]);
    expect(fs.existsSync(path.join(dst, '.harness', 'checkpoints.yml'))).toBe(false);
  });

  it('目标已有旧文件 → 覆盖为源内容', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);
    writeSrc(path.join(dst, '.harness', 'config.yml'), 'constraints: {}\n');

    propagateConfig(src, dst);

    expect(fs.readFileSync(path.join(dst, '.harness', 'config.yml'), 'utf-8')).toBe(CONFIG_YML);
  });

  it('源无任何 harness 配置 → 返回空，目标零副作用', () => {
    const copied = propagateConfig(src, dst);

    expect(copied).toEqual([]);
    expect(fs.existsSync(path.join(dst, '.harness'))).toBe(false);
  });
});
