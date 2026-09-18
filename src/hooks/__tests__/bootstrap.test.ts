/**
 * Tests for bootstrap.ts — bootstrapHarness, bootstrapHarnessSync
 *
 * bootstrapHarness uses dynamic import(fs) which is async and can be tricky in tests.
 * bootstrapHarnessSync uses synchronous fs reads and is more straightforward.
 *
 * Uses temp directories to provide harness config.
 *
 * ADR-0027（#170）：hooks 管线面删除后本层只剩组合根职责——加载项目配置、
 * 装配 checker / SessionManager / TraceCollector。`hookDefinitions` / `hookConfigs`
 * 两参数与 `hooks` / `pipeline` 两字段随之消失，形状由编译期 + 运行期双钉冻结
 * （手法照 ADR-0022 对 AC-007 的改写）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { bootstrapHarnessSync, bootstrapHarness } from '../bootstrap';

function setupTempDir(dir: string): string {
  const harnessDir = path.join(dir, '.harness');
  fs.mkdirSync(harnessDir, { recursive: true });
  const config = {
    preset: 'standard',
    custom_constraints_file: 'custom-constraints.yml',
  };
  fs.writeFileSync(path.join(harnessDir, 'config.yml'), yaml.dump(config), 'utf-8');
  return harnessDir;
}

/** 已删字段的编译期钉：回灌（重新声明该字段）即 TS2578 红。纯读，不产生任何落盘副作用。 */
function assertPipelineSurfaceUnreachable(result: ReturnType<typeof bootstrapHarnessSync>): void {
  // @ts-expect-error hooks 字段随 ADR-0027 管线面删除
  const gone = result.hooks;
  expect(gone).toBeUndefined();
  // @ts-expect-error pipeline 字段随 ADR-0027 管线面删除
  const gone2 = result.pipeline;
  expect(gone2).toBeUndefined();
}

describe('bootstrapHarness', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync('bootstrap-async-');
    setupTempDir(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a HarnessBootstrap object with all required fields', async () => {
    const result = await bootstrapHarness(tempDir);
    expect(result).toHaveProperty('checker');
    expect(result).toHaveProperty('sessions');
    expect(result).toHaveProperty('projectPath', tempDir);
    expect(result).toHaveProperty('mergedConstraints');
    expect(Object.keys(result).sort()).toEqual(
      ['checker', 'mergedConstraints', 'projectPath', 'sessions'],
    );
  });

  it('initializes with the provided project path', async () => {
    const result = await bootstrapHarness(tempDir);
    expect(result.projectPath).toBe(tempDir);
  });

  it('uses process.cwd() when no project path is given', async () => {
    const result = await bootstrapHarness();
    expect(result).toHaveProperty('projectPath');
    expect(result.projectPath).toBeDefined();
  });

  it('creates SessionManager scoped to project path', async () => {
    const result = await bootstrapHarness(tempDir);
    result.sessions.createSession('async-session');
    const sessionDir = path.join(tempDir, '.harness', 'sessions', 'async-session');
    expect(fs.existsSync(sessionDir)).toBe(true);
  });

  it('works without .harness/config.yml (uses defaults)', async () => {
    const noConfigDir = fs.mkdtempSync('bootstrap-noconfig-');
    try {
      const result = await bootstrapHarness(noConfigDir);
      expect(result).toHaveProperty('checker');
      expect(result).toHaveProperty('projectPath', noConfigDir);
      expect(result.mergedConstraints).toHaveProperty('ironLaws');
    } finally {
      fs.rmSync(noConfigDir, { recursive: true, force: true });
    }
  });
});

describe('bootstrapHarnessSync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync('bootstrap-test-');
    setupTempDir(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a HarnessBootstrap object with all required fields', () => {
    const result = bootstrapHarnessSync(tempDir);
    expect(result).toHaveProperty('checker');
    expect(result).toHaveProperty('sessions');
    expect(result).toHaveProperty('projectPath', tempDir);
    expect(result).toHaveProperty('mergedConstraints');
    assertPipelineSurfaceUnreachable(result);
  });

  it('initializes with the provided project path', () => {
    const result = bootstrapHarnessSync(tempDir);
    expect(result.projectPath).toBe(tempDir);
  });

  it('initializes ConstraintChecker with merged constraints', () => {
    const result = bootstrapHarnessSync(tempDir);
    // Check that mergedConstraints has the expected structure
    expect(result.mergedConstraints).toHaveProperty('ironLaws');
    expect(result.mergedConstraints).toHaveProperty('guidelines');
  });

  it('uses process.cwd() when no project path is given', () => {
    // We cannot easily test process.cwd() fallback without mocking cwd,
    // but we can verify the function accepts undefined
    const result = bootstrapHarnessSync(undefined);
    // Should not throw with process.cwd() — harness directory may not exist
    expect(result).toHaveProperty('projectPath');
    expect(result.projectPath).toBeDefined();
  });

  it('creates SessionManager scoped to project path', () => {
    const result = bootstrapHarnessSync(tempDir);
    // SessionManager is created with resolvedPath — we can verify by
    // creating a session and checking the directory exists
    result.sessions.createSession('boot-session');
    const sessionDir = path.join(tempDir, '.harness', 'sessions', 'boot-session');
    expect(fs.existsSync(sessionDir)).toBe(true);
  });

  it('loads from .harness/config.yml when present', () => {
    // Write a custom config with specific settings
    const harnessDir = path.join(tempDir, '.harness');
    const config = {
      preset: 'relaxed',
    };
    fs.writeFileSync(path.join(harnessDir, 'config.yml'), yaml.dump(config), 'utf-8');
    const result = bootstrapHarnessSync(tempDir);
    // With relaxed preset, the merged constraints should only have iron laws
    expect(result.mergedConstraints).toBeDefined();
  });
});
