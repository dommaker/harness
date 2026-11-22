import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getEffectiveConstraints,
  HARNESS_CONFIG_FILES,
  propagateConfig,
} from '../../index';

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
  it('从包根铺放配置文件，返回相对路径清单且目标可读取生效约束', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);
    writeSrc(path.join('.harness', 'checkpoints.yml'), CHECKPOINTS_YML);

    const copied = propagateConfig(src, dst);

    expect(copied).toEqual([...HARNESS_CONFIG_FILES]);
    expect(fs.readFileSync(path.join(dst, '.harness', 'config.yml'), 'utf-8')).toBe(CONFIG_YML);
    expect(fs.readFileSync(path.join(dst, '.harness', 'checkpoints.yml'), 'utf-8')).toBe(CHECKPOINTS_YML);
    const effective = getEffectiveConstraints(dst);
    expect(effective.some(c => c.id === 'capability_sync')).toBe(false);
    expect(effective.length).toBeGreaterThan(0);
  });

  it('源文件缺失时跳过，返回实际铺放清单', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);

    const copied = propagateConfig(src, dst);

    expect(copied).toEqual([path.join('.harness', 'config.yml')]);
    expect(fs.existsSync(path.join(dst, '.harness', 'checkpoints.yml'))).toBe(false);
  });

  it('目标已有同名文件时覆盖为源内容', () => {
    writeSrc(path.join('.harness', 'config.yml'), CONFIG_YML);
    const target = path.join(dst, '.harness', 'config.yml');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'constraints: {}\n', 'utf-8');

    propagateConfig(src, dst);

    expect(fs.readFileSync(path.join(dst, '.harness', 'config.yml'), 'utf-8')).toBe(CONFIG_YML);
  });

  it('源无任何配置时返回空清单，且不创建目标 .harness 目录', () => {
    expect(propagateConfig(src, dst)).toEqual([]);
    expect(fs.existsSync(path.join(dst, '.harness'))).toBe(false);
  });
});
