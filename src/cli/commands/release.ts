/**
 * harness release 命令
 *
 * 完整 npm 发布流水线：tsc → dist 验证 → npm version → git push → npm publish → gh release。
 * 纯 CLI 实现，不依赖任何外部服务——依赖 harness 的环境（编排服务、运行时基础设施）
 * 因 harness 包损坏而故障时，此命令仍可独立作为发布兜底通道使用。
 *
 * 流程：
 *   1. Verify package
 *   2. Check branch (must be master/main) + remote sync + clean tree
 *   3. tsc build（项目本地确定的 TypeScript 可执行文件；缺失即失败，不做隐式下载）
 *   4. Verify dist files
 *   5. Bump version (npm version → commit + tag)
 *   6. Push (protected branch → create release PR instead)
 *   7. Check private flag
 *   8. npm publish (or skip if PR flow)
 *   9. GitHub Release（非致命告警，既有终态保留）
 *
 * 判定经返回值外溢（架构评审候选7）：前置闸门维持**首败即停**，每个闸门失败
 * 返回 `gate <id>: <原因>`；退出码映射在 bin/harness.js 唯一一处。输出经注入 io
 * 流式打印（分钟级子进程阶段不能静默）。
 * 步骤判负统一按子进程退出码（D2）：私有 run helper 返回 { code, stdout, stderr }，
 * code !== 0 即失败（ENOENT/超时等无数字退出码取非零缺省），不再以 stderr 文本内容
 * 猜测成败——发布链全部会改变状态/取证的命令（git 证据命令、npm version/publish、
 * 各次 git push、PR 流程 checkout）无一例外；仅 GitHub Release 保持既有非致命告警
 * 终态、成功后 remote URL 查询保持装饰性降级。GH006 保护分支识别仍在非零 push 后
 * 查看 stderr。
 * 子进程一律 argv 形状（utils/exec 的 execFileAsync），不拼 shell 字符串；
 * npm publish 自带 --registry，publish 前后不读写用户 npm 配置（P0.3）。
 */

import { existsSync } from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { verifyReleaseArtifacts } from '../../release';
import { readPackageJson } from '../../utils/package-json';
import { errorMessage } from '../../utils/error';
import { execFileAsync } from '../../utils/exec';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface ReleaseOptions {
  bumpType?: 'patch' | 'minor' | 'major';
  dryRun?: boolean;
}

/** 子进程结果：退出码是判负唯一依据（D2）；ENOENT/超时等无数字退出码的执行失败取非零缺省 */
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(file: string, args: string[], cwd: string, timeout = 60_000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd, encoding: 'utf-8', timeout });
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    // 失败 rejection 形状 Error & { code?, stdout?, stderr? }，逐字段窄化取数
    const err = e as { code?: unknown; stdout?: unknown; stderr?: unknown };
    const chunk = (v: unknown): string => (typeof v === 'string' ? v : v != null ? String(v) : '');
    const stdout = chunk(err.stdout);
    const stderr = chunk(err.stderr);
    const code = typeof err.code === 'number' ? err.code : 1;
    // errorMessage 仅在两路输出都为空时兜底（否则 stdout-only 错误会被通用文案盖掉）
    return { code, stdout: stdout.trim(), stderr: stderr.trim() || (stdout ? '' : errorMessage(e)) };
  }
}

/** 闸门失败结果：reason 含闸门标识，可被调用方逐闸门断言 */
function gateFail(gate: string, detail: string): CommandResult {
  return { kind: 'fail', reason: `gate ${gate}: ${detail}` };
}

/** 版本 bump 计算（dry-run 预告与实 bump 校验共用单点） */
function bumpedVersion(oldVersion: string, bumpType: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = oldVersion.split('.').map(Number);
  if (bumpType === 'major') return `${major + 1}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export async function release(options: ReleaseOptions, io: CommandIO = processIO): Promise<CommandResult> {
  const pkgPath = process.cwd();
  const bumpType = options.bumpType || 'patch';
  const dryRun = options.dryRun ?? false;

  // ── 1. Verify package ──
  const pkgJson = readPackageJson(pkgPath);
  if (!pkgJson) {
    logError(io, chalk.red(`❌ Not a package: ${pkgPath}`));
    return gateFail('package', `not a package: ${pkgPath}`);
  }
  const pkgName = pkgJson.name;
  const oldVersion = pkgJson.version;
  if (typeof oldVersion !== 'string' || !oldVersion) {
    logError(io, chalk.red('❌ package.json 缺少 version 字段'));
    return gateFail('version-field', 'package.json missing version field');
  }
  log(io, chalk.cyan(`📦 ${pkgName}@${oldVersion}`));
  log(io, chalk.cyan(`   bump: ${bumpType}${dryRun ? ' (dry-run)' : ''}`));

  // ── 2. Check branch (must be on master/main) ──
  const branchResult = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], pkgPath);
  if (branchResult.code !== 0) {
    const detail = branchResult.stderr || branchResult.stdout;
    logError(io, chalk.red('❌ Failed to determine current branch:'), detail.slice(0, 300));
    return gateFail('branch', `cannot determine current branch: ${detail.slice(0, 200)}`);
  }
  const currentBranch = branchResult.stdout.trim();
  if (currentBranch !== 'master' && currentBranch !== 'main') {
    logError(io, chalk.red(`❌ Must be on master or main branch to release. Currently on: ${currentBranch}`));
    logError(io, chalk.gray('   Run: git checkout master && git merge ' + currentBranch));
    return gateFail('branch', `must be on master or main branch, currently on ${currentBranch}`);
  }
  log(io, chalk.green(`✅ git: on ${currentBranch}`));

  // ── 2b. Check remote sync ──
  const fetchResult = await run('git', ['fetch', 'origin'], pkgPath, 15_000);
  if (fetchResult.code !== 0) {
    const detail = fetchResult.stderr || fetchResult.stdout;
    logError(io, chalk.red('❌ git fetch failed:'), detail.slice(0, 300));
    return gateFail('remote-sync', `git fetch failed: ${detail.slice(0, 200)}`);
  }
  const behind = await run('git', ['rev-list', '--count', `HEAD..origin/${currentBranch}`], pkgPath);
  if (behind.code !== 0) {
    const detail = behind.stderr || behind.stdout;
    logError(io, chalk.red('❌ Cannot compare with remote:'), detail.slice(0, 300));
    return gateFail('remote-sync', `cannot compare with origin/${currentBranch}: ${detail.slice(0, 200)}`);
  }
  if (behind.stdout.trim() !== '0') {
    logError(io, chalk.red(`❌ Local ${currentBranch} is ${behind.stdout.trim()} commits behind origin/${currentBranch}. Pull first.`));
    return gateFail('remote-sync', `local ${currentBranch} is ${behind.stdout.trim()} commits behind origin/${currentBranch}`);
  }
  log(io, chalk.green('✅ git: synced with remote'));

  // ── 2c. Check clean working tree ──
  const stat = await run('git', ['status', '--porcelain', '-uno'], pkgPath);
  if (stat.code !== 0) {
    const detail = stat.stderr || stat.stdout;
    logError(io, chalk.red('❌ git status failed:'), detail.slice(0, 300));
    return gateFail('clean-tree', `git status failed: ${detail.slice(0, 200)}`);
  }
  if (stat.stdout.length > 0) {
    logError(io, chalk.red('❌ Uncommitted changes. Commit or stash before releasing.'));
    logError(io, chalk.gray(stat.stdout.slice(0, 500)));
    return gateFail('clean-tree', 'working tree has uncommitted changes');
  }
  log(io, chalk.green('✅ git: clean'));

  // ── 3. tsc build（项目本地确定的 TypeScript 可执行文件；缺失即失败，不做隐式下载）──
  log(io, chalk.cyan('🔨 Building...'));
  const tscPath = path.join(pkgPath, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tscPath)) {
    logError(io, chalk.red('❌ TypeScript not installed:'), tscPath);
    logError(io, chalk.gray('   Install project dependencies first (npm ci).'));
    return gateFail('build', `typescript executable not found: ${tscPath}`);
  }
  const build = await run(process.execPath, [tscPath], pkgPath, 60_000);
  if (build.code !== 0) {
    const detail = build.stderr || build.stdout;
    logError(io, chalk.red('❌ tsc failed:'), detail.slice(0, 800));
    return gateFail('build', `tsc failed: ${detail.slice(0, 200)}`);
  }
  log(io, chalk.green('✅ tsc: built'));

  // ── 4. Verify dist（发布物完整性自检，harness#77：清单随源码维护，不再本文件硬编码）──
  const integrity = verifyReleaseArtifacts(pkgPath);
  if (!integrity.ok) {
    logError(io, chalk.red(`❌ dist missing critical artifacts (${integrity.missing.length}): ${integrity.missing.join(', ')}`));
    return gateFail('dist-artifacts', `missing critical artifacts: ${integrity.missing.join(', ')}`);
  }
  log(io, chalk.green(`✅ dist: verified (${integrity.checked.length} critical artifacts)`));

  if (dryRun) {
    log(io, chalk.yellow(`🏁 Dry-run complete. Would publish: ${pkgName}@${bumpedVersion(oldVersion, bumpType)}`));
    return { kind: 'ok' };
  }

  // ── 5. Bump version (npm version creates git commit + tag atomically) ──
  log(io, chalk.cyan('🔢 Bumping version...'));
  const expectedNew = bumpedVersion(oldVersion, bumpType);
  const expectedTag = `v${expectedNew}`;
  const tagExists = await run('git', ['tag', '-l', expectedTag], pkgPath);
  if (tagExists.code !== 0) {
    const detail = tagExists.stderr || tagExists.stdout;
    logError(io, chalk.red('❌ Cannot verify existing tags:'), detail.slice(0, 300));
    return gateFail('tag-conflict', `cannot verify tag ${expectedTag}: ${detail.slice(0, 200)}`);
  }
  if (tagExists.stdout.trim() === expectedTag) {
    logError(io, chalk.red(`❌ Tag ${expectedTag} already exists. Version may have been released already.`));
    return gateFail('tag-conflict', `tag ${expectedTag} already exists`);
  }

  const bump = await run('npm', ['version', bumpType, '-m', 'release: %s'], pkgPath);
  if (bump.code !== 0) {
    const detail = bump.stderr || bump.stdout;
    logError(io, chalk.red('❌ npm version failed:'), detail.slice(0, 500));
    return gateFail('version-bump', `npm version ${bumpType} failed: ${detail.slice(0, 200)}`);
  }
  const newVersion = bump.stdout.trim().replace(/^v/, '');
  const tag = `v${newVersion}`;
  log(io, chalk.green(`✅ version: ${oldVersion} → ${newVersion} (committed + tagged)`));

  // ── 6. Push (handle protected branch via PR) ──
  log(io, chalk.cyan('⬆️  Pushing...'));
  const push = await run('git', ['push', 'origin', currentBranch], pkgPath, 30_000);
  const isProtected = push.code !== 0 &&
    (push.stderr.includes('GH006') || push.stderr.includes('protected branch'));

  if (isProtected) {
    // Protected branch: create release branch + PR
    const releaseBranch = `release/v${newVersion}`;
    log(io, chalk.yellow(`⚠️  ${currentBranch} is protected. Creating PR via ${releaseBranch}...`));

    const createBranch = await run('git', ['checkout', '-b', releaseBranch], pkgPath);
    if (createBranch.code !== 0) {
      const detail = createBranch.stderr || createBranch.stdout;
      logError(io, chalk.red('❌ git checkout failed:'), detail.slice(0, 500));
      return gateFail('pr-branch', `git checkout -b ${releaseBranch} failed: ${detail.slice(0, 200)}`);
    }
    const pushBranch = await run('git', ['push', 'origin', releaseBranch], pkgPath, 30_000);
    if (pushBranch.code !== 0) {
      const detail = pushBranch.stderr || pushBranch.stdout;
      logError(io, chalk.red('❌ git push failed:'), detail.slice(0, 500));
      return gateFail('git-push', `git push origin ${releaseBranch} failed: ${detail.slice(0, 200)}`);
    }

    // Create PR
    const prBody = `## Release ${pkgName}@${newVersion}\n\n- Bump version: ${oldVersion} → ${newVersion}\n- Changelog updated\n\nAfter merge, push tag to trigger npm publish:\n\`\`\`\ngit push origin ${tag}\n\`\`\``;
    const pr = await run('gh', ['pr', 'create', '--title', `release: ${pkgName}@${newVersion}`, '--body', prBody, '--base', currentBranch], pkgPath, 30_000);
    if (pr.code === 0 && pr.stdout) {
      log(io, chalk.green(`✅ PR created: ${pr.stdout.trim()}`));
    } else {
      const detail = pr.stderr || pr.stdout;
      logError(io, chalk.red('❌ PR creation failed:'), detail.slice(0, 500));
      return gateFail('pr-create', `gh pr create failed: ${detail.slice(0, 200)}`);
    }

    // Switch back to original branch
    const switchBack = await run('git', ['checkout', currentBranch], pkgPath);
    if (switchBack.code !== 0) {
      const detail = switchBack.stderr || switchBack.stdout;
      logError(io, chalk.red('❌ git checkout failed:'), detail.slice(0, 500));
      return gateFail('pr-branch', `git checkout ${currentBranch} failed: ${detail.slice(0, 200)}`);
    }

    log(io, chalk.cyan('\n📋 Next steps:'));
    log(io, chalk.gray(`   1. Merge the PR: ${pr.stdout.trim()}`));
    log(io, chalk.gray(`   2. After merge, push tag to trigger npm publish:`));
    log(io, chalk.gray(`      git push origin ${tag}`));
    log(io, chalk.gray(`   3. Or run: gh release create ${tag} --generate-notes`));
    return { kind: 'ok' };
  }

  if (push.code !== 0) {
    const detail = push.stderr || push.stdout;
    logError(io, chalk.red('❌ git push failed:'), detail.slice(0, 500));
    return gateFail('git-push', `git push origin ${currentBranch} failed: ${detail.slice(0, 200)}`);
  }
  const tagPush = await run('git', ['push', 'origin', tag], pkgPath, 30_000);
  if (tagPush.code !== 0) {
    const detail = tagPush.stderr || tagPush.stdout;
    logError(io, chalk.red('❌ git push tag failed:'), detail.slice(0, 500));
    return gateFail('git-push', `git push origin ${tag} failed: ${detail.slice(0, 200)}`);
  }
  log(io, chalk.green('✅ git: pushed'));

  // ── 7. Check private flag ──
  if (pkgJson.private) {
    logError(io, chalk.red('❌ package.json has "private": true. Remove it before publishing.'));
    logError(io, chalk.gray('   The release tool will NOT auto-remove private flag.'));
    return gateFail('private-flag', 'package.json has "private": true');
  }
  log(io, chalk.green('✅ package: not private'));

  // ── 8. npm publish（--registry 随命令携带，不读写用户 npm 配置）──
  log(io, chalk.cyan('📤 Publishing to npm...'));
  const publish = await run('npm', ['publish', '--registry', 'https://registry.npmjs.org/'], pkgPath, 180_000);
  if (publish.code !== 0) {
    const detail = publish.stderr || publish.stdout;
    logError(io, chalk.red('❌ npm publish failed:'), detail.slice(0, 500));
    return gateFail('npm-publish', `npm publish failed: ${detail.slice(0, 200)}`);
  }
  const verify = await run('npm', ['view', String(pkgName), 'version', '--registry', 'https://registry.npmjs.org/'], pkgPath);
  if (verify.code !== 0) {
    logError(io, chalk.red(`❌ npm publish verification failed: npm view exited ${verify.code}. Expected ${newVersion}, registry has ${verify.stdout.trim() || '???'}`));
    return gateFail('npm-publish-verify', `npm view exited ${verify.code}; expected ${newVersion}, registry has ${verify.stdout.trim() || '???'}`);
  }
  if (verify.stdout.trim() === newVersion) {
    log(io, chalk.green(`✅ npm: published ${pkgName}@${newVersion}`));
  } else {
    logError(io, chalk.red(`❌ npm publish verification failed. Expected ${newVersion}, registry has ${verify.stdout.trim() || '???'}`));
    return gateFail('npm-publish-verify', `expected ${newVersion}, registry has ${verify.stdout.trim() || '???'}`);
  }

  // ── 9. GitHub Release ──
  log(io, chalk.cyan('🐙 Creating GitHub Release...'));
  const gh = await run('gh', ['release', 'create', tag, '--generate-notes'], pkgPath, 30_000);
  if (gh.code === 0) {
    let repoUrl = '';
    try {
      const remoteUrl = (await run('git', ['remote', 'get-url', 'origin'], pkgPath, 5_000)).stdout.trim();
      const m = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/\s.]+?)(?:\.git)?$/);
      if (m) repoUrl = `https://github.com/${m[1]}/${m[2]}/releases/tag/${tag}`;
    } catch { /* no remote */ }
    log(io, chalk.green(`✅ GitHub Release: ${repoUrl || tag}`));
  } else if (gh.stderr.includes('already exists')) {
    log(io, chalk.yellow(`⚠️  gh: release ${tag} already exists`));
  } else {
    log(io, chalk.yellow(`⚠️  gh: release may have failed (non-fatal): ${(gh.stderr || gh.stdout).slice(0, 200)}`));
  }

  log(io, chalk.green(`\n🎉 Released ${pkgName}@${newVersion}`));
  log(io, chalk.gray(`   npm: https://www.npmjs.com/package/${pkgName}/v/${newVersion}`));
  return { kind: 'ok' };
}
