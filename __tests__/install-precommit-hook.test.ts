/**
 * bin/install-precommit-hook.sh 测试（工单 36）
 *
 * .git/hooks 不进版本库、新 clone 不带钩子，且裸名 npx harness 会解析到
 * npm 同名陌生包（rsdoiel/harness@0.0.6）。安装脚本是钩子的跟踪生成源，
 * 保证新 clone 一条命令装回 dogfood 当前 HEAD 的 node bin/harness.js 版钩子。
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALLER = path.join(REPO_ROOT, 'bin', 'install-precommit-hook.sh');

function install(gitDir: string): void {
  execFileSync('bash', [INSTALLER, gitDir], { cwd: REPO_ROOT, stdio: 'pipe' });
}

describe('bin/install-precommit-hook.sh', () => {
  let tmpRoot: string;
  let hookPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hook-'));
    hookPath = path.join(tmpRoot, '.git', 'hooks', 'pre-commit');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('创建 hooks 目录并落盘可执行钩子', () => {
    install(path.join(tmpRoot, '.git'));

    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.statSync(hookPath).mode & 0o111).not.toBe(0);
  });

  it('钩子用 node bin/harness.js 检查，无裸名 npx harness 命令调用', () => {
    install(path.join(tmpRoot, '.git'));

    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('set -e');
    expect(content).toContain('CHECK_OUTPUT=$(node bin/harness.js check --staged 2>&1)');
    // 只允许注释里解释性出现裸名，不允许任何命令式调用
    expect(content).not.toMatch(/npx harness\s+[a-z-]+/);
  });

  it('重复安装幂等覆盖（漂移内容被清除）', () => {
    install(path.join(tmpRoot, '.git'));
    fs.appendFileSync(hookPath, '\n# manual drift\n');

    install(path.join(tmpRoot, '.git'));

    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).not.toContain('manual drift');
    expect(content).toContain('node bin/harness.js check --staged');
  });
});
