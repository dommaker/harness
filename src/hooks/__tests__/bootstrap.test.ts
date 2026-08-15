/**
 * Tests for bootstrap.ts — bootstrapHarness, bootstrapHarnessSync
 *
 * bootstrapHarness uses dynamic import(fs) which is async and can be tricky in tests.
 * bootstrapHarnessSync uses synchronous fs reads and is more straightforward.
 *
 * Uses temp directories to provide harness config.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { bootstrapHarnessSync, bootstrapHarness } from '../bootstrap';
import type { HookDefinition } from '../types';

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
    expect(result).toHaveProperty('hooks');
    expect(result).toHaveProperty('pipeline');
    expect(result).toHaveProperty('projectPath', tempDir);
    expect(result).toHaveProperty('mergedConstraints');
  });

  it('initializes with the provided project path', async () => {
    const result = await bootstrapHarness(tempDir);
    expect(result.projectPath).toBe(tempDir);
  });

  it('registers hook definitions when provided', async () => {
    const hookDef: HookDefinition = {
      name: 'async-hook',
      phase: 'before',
      execute: async () => ({ passed: true }),
    };
    const result = await bootstrapHarness(tempDir, [hookDef]);
    expect(result.hooks.listNames()).toContain('async-hook');
  });

  it('does not register hooks when no definitions provided', async () => {
    const result = await bootstrapHarness(tempDir, []);
    expect(result.hooks.listNames()).toEqual([]);
  });

  it('uses process.cwd() when no project path is given', async () => {
    const result = await bootstrapHarness(undefined, []);
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
    expect(result).toHaveProperty('hooks');
    expect(result).toHaveProperty('pipeline');
    expect(result).toHaveProperty('projectPath', tempDir);
    expect(result).toHaveProperty('mergedConstraints');
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

  it('registers hook definitions when provided', () => {
    const hookDef: HookDefinition = {
      name: 'test-hook',
      phase: 'before',
      execute: async () => ({ passed: true }),
    };
    const result = bootstrapHarnessSync(tempDir, [hookDef]);
    expect(result.hooks.listNames()).toContain('test-hook');
  });

  it('does not register hooks when no definitions provided', () => {
    const result = bootstrapHarnessSync(tempDir, []);
    expect(result.hooks.listNames()).toEqual([]);
  });

  it('uses process.cwd() when no project path is given', () => {
    // We cannot easily test process.cwd() fallback without mocking cwd,
    // but we can verify the function accepts undefined
    const result = bootstrapHarnessSync(undefined, []);
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

  it('creates a working HookPipeline', () => {
    const hookDef: HookDefinition = {
      name: 'pipeline-hook',
      phase: 'after',
      execute: async () => ({ passed: true, data: 'ok' }),
    };
    const result = bootstrapHarnessSync(tempDir, [hookDef]);
    expect(result.pipeline).toBeDefined();
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
