#!/usr/bin/env npx tsx
/**
 * harness release — 一键发布流程
 *
 * 流程:
 *   1. harness sync-docs --check    检测文档新鲜度
 *   2. harness sync-docs            自动修复文档漂移
 *   3. harness check                检查约束
 *   4. git diff 确认无遗漏
 *   5. npm version patch|minor|major bump
 *   6. git push + git push --tags
 *   7. npm publish (本地)           推到 npm registry
 *   8. gh release create            创建 GitHub Release
 *
 * 用法: npx tsx scripts/release.ts [patch|minor|major] [--dry-run]
 *
 * 配置: 从环境变量读取
 *   NPM_REGISTRY  — npm registry (默认 https://registry.npmjs.org/)
 *   GH_TOKEN      — GitHub token (默认 gh CLI)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const BUMP = process.argv.find(a => ['patch', 'minor', 'major'].includes(a)) || 'patch';
const NPM_REGISTRY = process.env.NPM_REGISTRY || 'https://registry.npmjs.org/';

function sh(cmd: string, opts?: { cwd?: string; silent?: boolean }): string {
  try {
    const result = execSync(cmd, { cwd: opts?.cwd || ROOT, encoding: 'utf-8', stdio: DRY_RUN ? 'pipe' : 'inherit' });
    return result;
  } catch (e: any) {
    console.error(`❌ Command failed: ${cmd}\n${e.stderr || e.message}`);
    process.exit(1);
  }
}

function shQuiet(cmd: string, opts?: { cwd?: string }): string {
  try {
    return execSync(cmd, { cwd: opts?.cwd || ROOT, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return '';
  }
}

async function main() {
  console.log('🚀 Harness Release Pipeline\n');

  // ── Step 1: Check freshness ──
  console.log('📋 Step 1: Check document freshness...');
  const checkResult = shQuiet('node bin/harness.js sync-docs --check');
  if (checkResult.includes('不是最新的') || checkResult.includes('stale')) {
    console.log('   ⚠️  Documents are stale.');
  } else {
    console.log('   ✅ All fresh.');
  }

  // ── Step 2: Sync docs ──
  console.log('\n📝 Step 2: Sync documents...');
  sh('node bin/harness.js sync-docs');

  // ── Step 3: Constraint check ──
  console.log('\n🔍 Step 3: Constraint check...');
  const checkPassed = shQuiet('node bin/harness.js check 2>&1 || true');
  if (checkPassed.includes('异常') || checkPassed.includes('violation')) {
    console.log('   ⚠️  Constraints have warnings, but proceeding...');
  } else if (checkPassed.includes('通过')) {
    console.log('   ✅ All passed.');
  }

  // ── Step 4: Check git status ──
  console.log('\n🔎 Step 4: Git status...');
  const status = shQuiet('git status --short');
  if (status) {
    console.log('   Uncommitted changes:');
    console.log(status.split('\n').map(l => `   ${l}`).join('\n'));
  } else {
    console.log('   ✅ Clean.');
  }

  if (DRY_RUN) {
    console.log('\n🏃 DRY RUN — stopping before version bump.');
    return;
  }

  // ── Step 5: Version bump ──
  console.log(`\n📌 Step 5: Bump version (${BUMP})...`);
  const oldVer = JSON.parse(readFileSync('package.json', 'utf-8')).version;

  // Temporarily remove private flag
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  delete pkg.private;
  delete pkg.scripts?.prepublish;
  delete pkg.scripts?.prepare;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

  sh(`npm version ${BUMP} --no-git-tag-version --registry ${NPM_REGISTRY}`);
  const newVer = JSON.parse(readFileSync('package.json', 'utf-8')).version;
  console.log(`   ${oldVer} → ${newVer}`);

  // ── Step 6: Commit + push + tag ──
  console.log('\n📤 Step 6: Commit, push, tag...');
  sh(`git add -u  # only tracked files`);
  sh(`git commit -m "chore: release v${newVer}" --no-verify`);
  sh(`git push origin master 2>/dev/null || true`);
  sh(`git tag v${newVer}`);
  sh(`git push origin v${newVer}`);

  // ── Step 7: npm publish ──
  console.log('\n📦 Step 7: npm publish...');
  // Remove nested pnpm store (causes hard link errors)
  shQuiet('rm -rf src/tools/core/node_modules');
  sh(`npm publish --registry ${NPM_REGISTRY} --ignore-scripts`);

  // Restore private flag — read fresh package.json (version was bumped)
  const publishedPkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  publishedPkg.private = true;
  writeFileSync('package.json', JSON.stringify(publishedPkg, null, 2) + '\n');
  // Commit the restored private flag
  sh(`git add package.json`);
  sh(`git commit -m "chore: restore private flag after publish" --no-verify`);
  sh(`git push origin master 2>/dev/null || true`);

  // ── Step 8: GitHub Release ──
  console.log('\n🎉 Step 8: GitHub Release...');
  const changelog = extractChangelog(newVer);
  const releaseCmd = `gh release create v${newVer} --title "v${newVer}" --notes "${changelog.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  try {
    sh(releaseCmd);
    console.log(`   ✅ Release created: v${newVer}`);
  } catch {
    console.log('   ⚠️  GitHub Release failed (run manually).');
  }

  console.log(`\n✅ Release v${newVer} complete!\n`);
}

function extractChangelog(version: string): string {
  try {
    const changelog = readFileSync('CHANGELOG.md', 'utf-8');
    const match = changelog.match(new RegExp(`## \\[${version}\\].*?(?=## \\[|$)`, 's'));
    return match ? match[0].trim() : `Release v${version}`;
  } catch {
    return `Release v${version}`;
  }
}

main().catch(console.error);
