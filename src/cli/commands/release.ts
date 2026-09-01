/**
 * harness release 命令
 *
 * 完整 npm 发布流水线：tsc → dist 验证 → npm version → git push → npm publish → gh release。
 * 与 studio MCP tool `publishPackage` 共享同一逻辑，但此 CLI 命令不依赖 Studio API 运行。
 * 当 studio API 因 harness 包损坏而无法启动时，此 CLI 命令仍可用。
 *
 * 流程：
 *   1. Verify package
 *   2. Check branch (must be master/main) + remote sync + clean tree
 *   3. tsc build
 *   4. Verify dist files
 *   5. Bump version (npm version → commit + tag)
 *   6. Push (protected branch → create release PR instead)
 *   7. Check private flag
 *   8. npm publish (or skip if PR flow)
 *   9. GitHub Release
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { verifyReleaseArtifacts } from '../../release';

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

  // ── 2. Check branch (must be on master/main) ──
  const branchResult = await run('git rev-parse --abbrev-ref HEAD', pkgPath);
  const currentBranch = branchResult.stdout.trim();
  if (currentBranch !== 'master' && currentBranch !== 'main') {
    console.error(chalk.red(`❌ Must be on master or main branch to release. Currently on: ${currentBranch}`));
    console.error(chalk.gray('   Run: git checkout master && git merge ' + currentBranch));
    process.exit(1);
  }
  console.log(chalk.green(`✅ git: on ${currentBranch}`));

  // ── 2b. Check remote sync ──
  await run('git fetch origin', pkgPath, 15_000);
  const behind = await run(`git rev-list --count HEAD..origin/${currentBranch}`, pkgPath);
  if (behind.stdout.trim() !== '0') {
    console.error(chalk.red(`❌ Local ${currentBranch} is ${behind.stdout.trim()} commits behind origin/${currentBranch}. Pull first.`));
    process.exit(1);
  }
  console.log(chalk.green('✅ git: synced with remote'));

  // ── 2c. Check clean working tree ──
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

  // ── 4. Verify dist（发布物完整性自检，harness#77：清单随源码维护，不再本文件硬编码）──
  const integrity = verifyReleaseArtifacts(pkgPath);
  if (!integrity.ok) {
    console.error(chalk.red(`❌ dist missing critical artifacts (${integrity.missing.length}): ${integrity.missing.join(', ')}`));
    process.exit(1);
  }
  console.log(chalk.green(`✅ dist: verified (${integrity.checked.length} critical artifacts)`));

  if (dryRun) {
    const [major, minor, patch] = oldVersion.split('.').map(Number);
    let newVer: string;
    if (bumpType === 'major') newVer = `${major + 1}.0.0`;
    else if (bumpType === 'minor') newVer = `${major}.${minor + 1}.0`;
    else newVer = `${major}.${minor}.${patch + 1}`;
    console.log(chalk.yellow(`🏁 Dry-run complete. Would publish: ${pkgName}@${newVer}`));
    process.exit(0);
  }

  // ── 5. Bump version (npm version creates git commit + tag atomically) ──
  console.log(chalk.cyan('🔢 Bumping version...'));
  const [major, minor, patch] = oldVersion.split('.').map(Number);
  let expectedNew: string;
  if (bumpType === 'major') expectedNew = `${major + 1}.0.0`;
  else if (bumpType === 'minor') expectedNew = `${major}.${minor + 1}.0`;
  else expectedNew = `${major}.${minor}.${patch + 1}`;
  const expectedTag = `v${expectedNew}`;
  const tagExists = await run(`git tag -l "${expectedTag}"`, pkgPath);
  if (tagExists.stdout.trim() === expectedTag) {
    console.error(chalk.red(`❌ Tag ${expectedTag} already exists. Version may have been released already.`));
    process.exit(1);
  }

  const bump = await run(`npm version ${bumpType} -m "release: %s"`, pkgPath);
  if (bump.stderr && !bump.stdout) {
    console.error(chalk.red('❌ npm version failed:'), bump.stderr);
    process.exit(1);
  }
  const newVersion = bump.stdout.trim().replace(/^v/, '');
  const tag = `v${newVersion}`;
  console.log(chalk.green(`✅ version: ${oldVersion} → ${newVersion} (committed + tagged)`));

  // ── 6. Push (handle protected branch via PR) ──
  console.log(chalk.cyan('⬆️  Pushing...'));
  const push = await run(`git push origin ${currentBranch}`, pkgPath, 30_000);
  const isProtected = push.stderr.includes('GH006') || push.stderr.includes('protected branch');

  if (isProtected) {
    // Protected branch: create release branch + PR
    const releaseBranch = `release/v${newVersion}`;
    console.log(chalk.yellow(`⚠️  ${currentBranch} is protected. Creating PR via ${releaseBranch}...`));

    await run(`git checkout -b ${releaseBranch}`, pkgPath);
    await run(`git push origin ${releaseBranch}`, pkgPath, 30_000);

    // Create PR
    const prBody = `## Release ${pkgName}@${newVersion}\n\n- Bump version: ${oldVersion} → ${newVersion}\n- Changelog updated\n\nAfter merge, push tag to trigger npm publish:\n\`\`\`\ngit push origin ${tag}\n\`\`\``;
    const pr = await run(`gh pr create --title "release: ${pkgName}@${newVersion}" --body "${prBody}" --base ${currentBranch}`, pkgPath, 30_000);
    if (pr.stdout) {
      console.log(chalk.green(`✅ PR created: ${pr.stdout.trim()}`));
    } else {
      console.error(chalk.red('❌ PR creation failed:'), pr.stderr.slice(0, 500));
      process.exit(1);
    }

    // Switch back to original branch
    await run(`git checkout ${currentBranch}`, pkgPath);

    console.log(chalk.cyan('\n📋 Next steps:'));
    console.log(chalk.gray(`   1. Merge the PR: ${pr.stdout.trim()}`));
    console.log(chalk.gray(`   2. After merge, push tag to trigger npm publish:`));
    console.log(chalk.gray(`      git push origin ${tag}`));
    console.log(chalk.gray(`   3. Or run: gh release create ${tag} --generate-notes`));
    return;
  }

  if (push.stderr && push.stderr.includes('error')) {
    console.error(chalk.red('❌ git push failed:'), push.stderr.slice(0, 500));
    process.exit(1);
  }
  await run(`git push origin ${tag}`, pkgPath, 30_000);
  console.log(chalk.green('✅ git: pushed'));

  // ── 7. Check private flag ──
  if (pkgJson.private) {
    console.error(chalk.red('❌ package.json has "private": true. Remove it before publishing.'));
    console.error(chalk.gray('   The release tool will NOT auto-remove private flag.'));
    process.exit(1);
  }
  console.log(chalk.green('✅ package: not private'));

  // ── 8. npm publish ──
  const origRegistry = await run('npm config get registry', pkgPath);
  await run('npm config set registry https://registry.npmjs.org/', pkgPath);
  console.log(chalk.cyan('📤 Publishing to npm...'));
  await run('npm publish --registry https://registry.npmjs.org/', pkgPath, 180_000);
  await run(`npm config set registry ${origRegistry.stdout}`, pkgPath);
  const verify = await run(`npm view ${pkgName} version --registry https://registry.npmjs.org/`, pkgPath);
  if (verify.stdout.trim() === newVersion) {
    console.log(chalk.green(`✅ npm: published ${pkgName}@${newVersion}`));
  } else {
    console.error(chalk.red(`❌ npm publish verification failed. Expected ${newVersion}, registry has ${verify.stdout.trim() || '???'}`));
    process.exit(1);
  }

  // ── 9. GitHub Release ──
  console.log(chalk.cyan('🐙 Creating GitHub Release...'));
  const gh = await run(`gh release create ${tag} --generate-notes`, pkgPath, 30_000);
  if (gh.stderr && gh.stderr.includes('already exists')) {
    console.log(chalk.yellow(`⚠️  gh: release ${tag} already exists`));
  } else if (gh.stderr) {
    console.log(chalk.yellow(`⚠️  gh: release may have failed (non-fatal): ${gh.stderr.slice(0, 200)}`));
  } else {
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
