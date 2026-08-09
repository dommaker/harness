/**
 * check 命令注入漂移警告测试（ADR-0001 决策 7，P6）
 *
 * 警告不阻断：漂移项目跑 check 仍 0 退出；版本漂移单独显眼警告；
 * 无漂移零输出。使用真实临时目录（漂移检测读真实 fs），
 * 仅 mock checker（直接判过）与 git 调用。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { check } from '../check';
import { constraintChecker } from '../../../core/constraints/checker';
import { renderConstraintsSection } from '../../../core/constraints/injection-renderer';
import { getEffectiveConstraints } from '../../../core/effective-constraints';

jest.mock('../../../core/constraints/checker', () => ({
  constraintChecker: {
    setCustomConfig: jest.fn(),
    setTraceRecorder: jest.fn(),
    checkConstraints: jest.fn(),
  },
}));

jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(() => Buffer.from('')),
}));

const mockChecker = constraintChecker as jest.Mocked<typeof constraintChecker>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const REAL_VERSION = require('../../../../package.json').version as string;

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-check-drift-test-'));
}

function writeClaudeMd(root: string, version: string): void {
  const section =
    '## Governance Rules\n' + renderConstraintsSection(getEffectiveConstraints(root), version);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# Test Project\n\n${section}`, 'utf-8');
}

describe('check 命令注入漂移警告', () => {
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockChecker.checkConstraints.mockResolvedValue({
      passed: true,
      ironLaws: [],
      guidelines: [],
      tips: [],
      warningCount: 0,
      tipCount: 0,
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  const outputText = () => consoleSpy.mock.calls.map(c => String(c[0])).join('\n');

  it('版本漂移：黄色警告块 + ⚠️⚠️ 版本行，但不阻断（exit 未调用，仍判通过）', async () => {
    const root = makeTmpProject();
    writeClaudeMd(root, '0.0.1-old');

    await check({ preset: 'standard', staged: false, projectPath: root });

    const output = outputText();
    expect(output).toContain('约束注入漂移');
    expect(output).toContain('⚠️⚠️');
    expect(output).toContain('agent 上下文中的规则与已安装 harness 版本不一致');
    expect(output).toContain('0.0.1-old');
    expect(output).toContain('npx harness init');
    // 不阻断：检查仍通过、未调用 process.exit
    expect(output).toContain('约束检查通过');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('内容漂移：手改一条 → 警告块含缺失/多余计数，exit 未调用', async () => {
    const root = makeTmpProject();
    writeClaudeMd(root, REAL_VERSION);
    const claudeMdPath = path.join(root, 'CLAUDE.md');
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const originalLine = content.split('\n').find(l => l.startsWith('- **'))!;
    fs.writeFileSync(claudeMdPath, content.replace(originalLine, originalLine.replace(/: .+$/, ': 篡改')), 'utf-8');

    await check({ preset: 'standard', staged: false, projectPath: root });

    const output = outputText();
    expect(output).toContain('内容漂移: 缺失 1 条 / 多余 1 条');
    expect(output).toContain('约束检查通过');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('无漂移：零警告输出（不增加噪音）', async () => {
    const root = makeTmpProject();
    writeClaudeMd(root, REAL_VERSION);

    await check({ preset: 'standard', staged: false, projectPath: root });

    const output = outputText();
    expect(output).not.toContain('注入漂移');
    expect(output).toContain('约束检查通过');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('未注入（无 CLAUDE.md）：不警告', async () => {
    const root = makeTmpProject();

    await check({ preset: 'standard', staged: false, projectPath: root });

    expect(outputText()).not.toContain('注入漂移');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
