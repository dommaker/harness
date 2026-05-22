/**
 * harness release 命令
 *
 * 完整 npm 发布流水线：tsc → dist 验证 → npm version → git push → npm publish → gh release。
 * 与 studio MCP tool `publishPackage` 共享同一逻辑，但此 CLI 命令不依赖 Studio API 运行。
 * 当 studio API 因 harness 包损坏而无法启动时，此 CLI 命令仍可用。
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export interface ReleaseOptions {
  bumpType?: 'patch' | 'minor' | 'major';
  dryRun?: string;
}

async function run(cmd: string, cwd: string, timeout = 60_000): Promise<{ stdout: string; stderr: string }> {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout });
    return { stdout: stdout.trim(), stderr: '' };
  } catch (e: any) {
    const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() || '';
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() || '';
    return { stdout: stdout.trim(), stderr: stderr.trim() || e.message || String(e) };
  }
}

export async function release(options: ReleaseOptions): Promise<void> {
  const pkgPath = process.cwd();
  const bumpType = options.bumpType || 'patch';
  const dryRun = options.dryRun === 'true';

  // ── 1. Verify package ──
  const pkgJsonPath = path.join(pkgPath, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    console.error(chalk.red(`❌ Not a package: ${pkgPath}`));
    process.exit(1);
  }
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const pkgName = pkgJson.name;
  const oldVersion = pkgJson.version;
  console.log(chalk.cyan(`📦 ${pkgName}@${oldVersion}`));
  console.log(chalk.cyan(`   bump: ${bumpType}${dryRun ? ' (dry-run)' : ''}`));

  // ── 2. Check clean working tree ──
  const stat = await run('git status --porcelain -uno', pkgPath);
  if (stat.stdout.length > 0) {
    console.error(chalk.red('❌ Uncommitted changes. Commit or stash before releasing.'));
    console.error(chalk.gray(stat.stdout.slice(0, 500)));
    process.exit(1);
  }
  console.log(chalk.green('✅ git: clean'));

  // ── 3. tsc build ──
  console.log(chalk.cyan('🔨 Building...'));
  const build = await run('npx tsc', pkgPath, 60_000);
  if (build.stderr && !build.stdout) {
    console.error(chalk.red('❌ tsc failed:'), build.stderr.slice(0, 800));
    process.exit(1);
  }
  console.log(chalk.green('✅ tsc: built'));

  // ── 4. Verify dist ──
  const criticalFiles = [
    'dist/index.js',
    'dist/knowledge/index.js',
    'dist/knowledge/store.js',
    'dist/knowledge/ingest.js',
    'dist/knowledge/query.js',
    'dist/knowledge/lifecycle.js',
    'dist/knowledge/lint.js',
    'dist/knowledge/types.js',
    'dist/knowledge/import.js',
    'dist/knowledge/reference-tracker.js',
    'dist/knowledge/lifecycle-hooks.js',
    'dist/knowledge/doctor.js',
    'dist/core/constraints/prompt-injection.js',
  ];
  const missing = criticalFiles.filter(f => !fs.existsSync(path.join(pkgPath, f)));
  if (missing.length > 0) {
    console.error(chalk.red(`❌ dist missing critical files: ${missing.join(', ')}`));
    process.exit(1);
  }
  console.log(chalk.green('✅ dist: verified'));

  if (dryRun) {
    const [major, minor, patch] = oldVersion.split('.').map(Number);
    let newVer: string;
    if (bumpType === 'major') newVer = `${major + 1}.0.0`;
    else if (bumpType === 'minor') newVer = `${major}.${minor + 1}.0`;
    else newVer = `${major}.${minor}.${patch + 1}`;
    console.log(chalk.yellow(`🏁 Dry-run complete. Would publish: ${pkgName}@${newVer}`));
    process.exit(0);
  }

  // ── 5. Bump version (npm version creates git commit + tag atomically,
  //     including package-lock.json — no desync possible) ──
  console.log(chalk.cyan('🔢 Bumping version...'));
  const bump = await run(`npm version ${bumpType} -m "release: %s"`, pkgPath);
  if (bump.stderr && !bump.stdout) {
    console.error(chalk.red('❌ npm version failed:'), bump.stderr);
    process.exit(1);
  }
  const newVersion = bump.stdout.trim().replace(/^v/, '');
  const tag = `v${newVersion}`;
  console.log(chalk.green(`✅ version: ${oldVersion} → ${newVersion} (committed + tagged)`));

  // ── 7. Push ──
  console.log(chalk.cyan('⬆️  Pushing...'));
  const branch = await run('git rev-parse --abbrev-ref HEAD', pkgPath);
  const push = await run(`git push origin ${branch.stdout}`, pkgPath, 30_000);
  if (push.stderr && push.stderr.includes('error')) {
    console.error(chalk.red('❌ git push failed:'), push.stderr.slice(0, 500));
    process.exit(1);
  }
  await run(`git push origin ${tag}`, pkgPath, 30_000);
  console.log(chalk.green('✅ git: pushed'));

  // ── 8. npm publish ──
  // Switch to npmjs.org for publishing (npmmirror is read-only mirror)
  const origRegistry = await run('npm config get registry', pkgPath);
  await run('npm config set registry https://registry.npmjs.org/', pkgPath);
  console.log(chalk.cyan('📤 Publishing to npm...'));
  // Redirect stderr→stdout. npm prints tarball to stdout, warnings to stderr.
  const pub = await run('npm publish 2>&1', pkgPath, 180_000);
  // Restore original registry before any error handling
  await run(`npm config set registry ${origRegistry.stdout}`, pkgPath);
  // Detect actual failures: "npm error" (npm v10+) or "ERR! code E" (older npm)
  const pubOutput = pub.stdout;
  const isFailure = pubOutput.includes('npm error') || pubOutput.includes('ERR! code E');
  if (isFailure) {
    if (!pubOutput.includes('previously published') && !pubOutput.includes('EPUBLISHCONFLICT')) {
      console.error(chalk.red('❌ npm publish failed:'), pubOutput.slice(0, 500));
      process.exit(1);
    }
    console.log(chalk.yellow(`⚠️  npm: ${pkgName}@${newVersion} already published (skipping)`));
  } else {
    console.log(chalk.green(`✅ npm: published ${pkgName}@${newVersion}`));
  }

  // ── 9. GitHub Release ──
  console.log(chalk.cyan('🐙 Creating GitHub Release...'));
  const gh = await run(`gh release create ${tag} --generate-notes`, pkgPath, 30_000);
  if (gh.stderr && gh.stderr.includes('already exists')) {
    console.log(chalk.yellow(`⚠️  gh: release ${tag} already exists`));
  } else if (gh.stderr) {
    console.log(chalk.yellow(`⚠️  gh: release may have failed (non-fatal): ${gh.stderr.slice(0, 200)}`));
  } else {
    // Derive repo URL from git remote
    let repoUrl = '';
    try {
      const remoteUrl = execSync('git remote get-url origin', { cwd: pkgPath, encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 }).trim();
      const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/);
      if (m) repoUrl = `https://github.com/${m[1]}/${m[2]}/releases/tag/${tag}`;
    } catch { /* no remote */ }
    console.log(chalk.green(`✅ GitHub Release: ${repoUrl || tag}`));
  }

  console.log(chalk.green(`\n🎉 Released ${pkgName}@${newVersion}`));
  console.log(chalk.gray(`   npm: https://www.npmjs.com/package/${pkgName}/v/${newVersion}`));
}
