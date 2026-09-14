/**
 * check 命令注入漂移警告测试（ADR-0001 决策 7，P6）
 *
 * 警告不阻断：漂移项目跑 check 仍 0 退出；版本漂移单独显眼警告；
 * 无漂移零输出。使用真实临时目录（漂移检测读真实 fs），
 * 仅 mock checker（直接判过）与 git 调用。
 */

import * as fs from 'fs';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as path from 'path';
import { check } from '../check';
import { renderConstraintsSection } from '../../../core/constraints/injection-renderer';
import { getEffectiveConstraints } from '../../../core/effective-constraints';
import { createProjectFixture } from '../../../test-setup/project-fixture';

// 命令 per-run 构造 checker（harness#88）：构造替身即控制 checkConstraints 返回值
const mockChecker = { checkConstraints: jest.fn() };
jest.mock('../../../core/constraints/checker', () => ({
  ConstraintChecker: jest.fn(function () {
    return mockChecker;
  }),
}));

jest.mock('../../../monitoring/traces', () => ({
  getTraceCollector: jest.fn(() => ({ record: jest.fn() })),
}));

jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn(() => Buffer.from('')),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const REAL_VERSION = require('../../../../package.json').version as string;

function writeClaudeMd(root: string, version: string): void {
  const section =
    '## Governance Rules\n' + renderConstraintsSection(getEffectiveConstraints(root), version);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# Test Project\n\n${section}`, 'utf-8');
}

describe('check 命令注入漂移警告', () => {
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
    mockChecker.checkConstraints.mockResolvedValue({
      passed: true,
      ironLaws: [],
      guidelines: [],
      warningCount: 0,
    });
  });

  const outputText = () => io.outText();

  it('版本漂移：黄色警告块 + ⚠️⚠️ 版本行，但不阻断（exit 未调用，仍判通过）', async () => {
    const root = createProjectFixture({ name: 'harness-check-drift-test' });
    writeClaudeMd(root, '0.0.1-old');

    const result = await check({ preset: 'standard', staged: false, projectPath: root }, io);

    const output = outputText();
    expect(output).toContain('约束注入漂移');
    expect(output).toContain('⚠️⚠️');
    expect(output).toContain('agent 上下文中的规则与已安装 harness 版本不一致');
    expect(output).toContain('0.0.1-old');
    expect(output).toContain('npx @dommaker/harness init');
    // 不阻断：检查仍通过、未调用 process.exit
    expect(output).toContain('约束检查通过');
    expect(result.kind).toBe('ok');
  });

  it('内容漂移：手改一条 → 警告块含缺失/多余计数，exit 未调用', async () => {
    const root = createProjectFixture({ name: 'harness-check-drift-test' });
    writeClaudeMd(root, REAL_VERSION);
    const claudeMdPath = path.join(root, 'CLAUDE.md');
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    const originalLine = content.split('\n').find(l => l.startsWith('- **'))!;
    fs.writeFileSync(claudeMdPath, content.replace(originalLine, originalLine.replace(/: .+$/, ': 篡改')), 'utf-8');

    const result = await check({ preset: 'standard', staged: false, projectPath: root }, io);

    const output = outputText();
    expect(output).toContain('内容漂移: 缺失 1 条 / 多余 1 条');
    expect(output).toContain('约束检查通过');
    expect(result.kind).toBe('ok');
  });

  it('无漂移：零警告输出（不增加噪音）', async () => {
    const root = createProjectFixture({ name: 'harness-check-drift-test' });
    writeClaudeMd(root, REAL_VERSION);

    const result = await check({ preset: 'standard', staged: false, projectPath: root }, io);

    const output = outputText();
    expect(output).not.toContain('注入漂移');
    expect(output).toContain('约束检查通过');
    expect(result.kind).toBe('ok');
  });

  it('未注入（无 CLAUDE.md）：不警告', async () => {
    const root = createProjectFixture({ name: 'harness-check-drift-test' });

    const result = await check({ preset: 'standard', staged: false, projectPath: root }, io);

    expect(outputText()).not.toContain('注入漂移');
    expect(result.kind).toBe('ok');
  });

  // ── 生效集来源与漂移比对的同一性（ADR-0023 步骤 4.5）──────────────────
  // 改前 CLI 给 -p 塞了缺省值 'standard'，「没传」与「传了」不可区分，
  // 于是「--preset 仅在无自定义配置时覆盖」这条规则恒被触发：项目 config.yml 的
  // preset 静默失效，而漂移侧按 config.yml 算 → 两边稳定对不上（该报的漂移不报）。

  it('config.yml 的 preset 不再被 CLI 缺省顶掉：不带 -p 按 relaxed 执法且零漂移', async () => {
    const root = createProjectFixture({
      name: 'harness-check-drift-relaxed',
      config: 'preset: relaxed\n',
    });
    writeClaudeMd(root, REAL_VERSION); // getEffectiveConstraints(root) 走 config.yml = relaxed

    const result = await check({ staged: false, projectPath: root }, io);

    // relaxed 裁掉的内置条目会出现在「已禁用约束」行——改前 CLI 塞了 standard，这行根本不出现
    const output = outputText();
    expect(output).toContain('已禁用约束:');
    expect(output).not.toContain('内容漂移');
    expect(output).toContain('约束检查通过');
    expect(result.kind).toBe('ok');
  });

  it('显式 -p 时，漂移比对用的就是本 run 实际执法的那份', async () => {
    const root = createProjectFixture({
      name: 'harness-check-drift-override',
      config: 'preset: relaxed\n',
    });
    writeClaudeMd(root, REAL_VERSION); // 段里是 relaxed 的少数条目

    await check({ preset: 'standard', staged: false, projectPath: root }, io);

    // standard 不裁条目（无「已禁用约束」行），且期望段 = 本 run 执法的 standard
    // → 段里条目只少不多，报「缺失 N 条 / 多余 0 条」
    const output = outputText();
    expect(output).not.toContain('已禁用约束:');
    expect(output).toMatch(/内容漂移: 缺失 [1-9]\d* 条 \/ 多余 0 条/);
  });
});
