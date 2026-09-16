/**
 * 脚手架模板数据（harness#132）
 *
 * 受管文件的正文正本，纯数据 + 纯渲染，零 IO、零上色——落盘语义与文案在
 * `scaffold.ts` 的 plan 里，本模块只回答「这个文件的内容是什么」。
 *
 * 刻意留在代码内而不落 `templates/` 目录：`templates/` 无运行时消费者
 * （harness 自身不读它），发布完整性清单（`release/integrity.ts`）也不覆盖它。
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Checkpoint } from '../../types/checkpoint';
import type { CiPlatform } from '../../types/project-config';

/** Git pre-commit 片段（#103：打印片段与落盘 hook 的唯一正本） */
export const PRE_COMMIT_SNIPPET = `
echo "🔍 Running harness checks..."

STAGED=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

# Harness 约束检查
npx @dommaker/harness check --staged
if [ $? -ne 0 ]; then
  echo "❌ Iron law check failed"
  exit 1
fi

# Plan coverage check (via PostEval)
if command -v npx > /dev/null 2>&1; then
  PLAN_FILES=$(echo "$STAGED" | grep -E 'plans/.*\\.md$|\\.plan\\.md$' || true)
  if [ -n "$PLAN_FILES" ]; then
    echo "📋 Checking plan coverage..."
    for plan in $PLAN_FILES; do
      npx @dommaker/harness posteval-plan "$plan" || {
        echo "🛑 Plan coverage incomplete. See above for missed items."
        exit 1
      }
    done
  fi
fi

echo "✅ All checks passed"
`;

/** 落盘的 pre-commit hook = shebang + 说明行 + 共享片段 */
export function renderPreCommitHook(): string {
  return `#!/bin/sh
# Harness pre-commit hook
${PRE_COMMIT_SNIPPET}`;
}

/**
 * Git pre-push 片段（harness#144；#103：打印片段与落盘 hook 的唯一正本）
 *
 * 三道决定都写在这段正文里，不再由代码补：
 * - **整仓全量**：`check` 不带 `--staged`，加一道 `validate`——它拦的是
 *   `git commit --no-verify` 绕过 pre-commit 的内容，重复是设计使然；
 * - **不做增量**：不解析 pre-push 从 stdin 收到的 `<local_ref> <local_oid>
 *   <remote_ref> <remote_oid>` 清单，无论推什么整仓过一遍；子进程也不给它读；
 * - **不内建逃生机制**：没有环境变量开关、没有超时、没有「慢则降级」，
 *   唯一的口子是 git 原生 `git push --no-verify`。
 */
export const PRE_PUSH_SNIPPET = `
echo "🔍 Running harness pre-push checks (whole repo)..."

# 分工：pre-commit 查暂存的（增量、快反馈），pre-push 查整仓的（全量、兜底）。
# 同一次改动跑两遍是设计使然——这道拦的是 git commit --no-verify 绕出去的内容。
# 本地 hook 只是自检与提醒，真正的门禁在服务端 CI；逃生口只有 git 原生 push --no-verify。
# 不解析 pre-push 从 stdin 收到的 ref 清单，子进程一律不给它读（< /dev/null）。
npx @dommaker/harness check < /dev/null
if [ $? -ne 0 ]; then
  echo "❌ Iron law check failed"
  exit 1
fi

npx @dommaker/harness validate < /dev/null
if [ $? -ne 0 ]; then
  echo "❌ Validate failed"
  exit 1
fi

echo "✅ All pre-push checks passed"
`;

/** 落盘的 pre-push hook = shebang + 说明行 + 共享片段 */
export function renderPrePushHook(): string {
  return `#!/bin/sh
# Harness pre-push hook
${PRE_PUSH_SNIPPET}`;
}

// ── GitLab CI（harness#143）：与 GH 版对仗的接线形状 ──────────────────────

/**
 * GitLab 任务的触发条件（决议 ⑥：用 `rules:` 不用过时的 `only:`）
 *
 * MR 事件 + main/master 分支 push，与 GH 版 `on:` 段一一对应。三个任务各自带一份
 * ——GitLab 的 `default:` 不支持 `rules`，自建实例版本参差，不赌语法糖。
 */
const GITLAB_RULES = `  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_COMMIT_BRANCH == "master"
`;

/** `.gitlab-ci.yml` 文件头：harness 只拥有其下的 `harness-*` 任务 */
const GITLAB_CI_HEADER = `# 由 harness init 生成 —— 以下 harness-* 任务是 harness 的 CI 接线
# 门禁真正生效还需在 GitLab 侧开分支保护：pipeline 成功才允许合并

image: node:20

stages:
  - test

`;

/** GitLab harness-check 任务（`--print-snippets` 打印的 job 片段即此份） */
export const GITLAB_CI_SNIPPET = `harness-check:
  stage: test
  script:
    - npm ci
    - npx @dommaker/harness check
    - npx @dommaker/harness validate
    - npx @dommaker/harness passes-gate
${GITLAB_RULES}`;

/** harness 拥有的 GitLab 任务全集（治理档在场时含治理任务）——落盘正文与冲突片段共用 */
export function renderGitLabCiJobs(governanceLevel?: string): string {
  return governanceLevel
    ? `${GITLAB_CI_SNIPPET}\n${renderGovernanceWorkflow(governanceLevel, 'gitlab')}`
    : GITLAB_CI_SNIPPET;
}

/** `.gitlab-ci.yml` 落盘全文正本（= 文件头 + harness 拥有的任务） */
export function renderGitLabCiFile(governanceLevel?: string): string {
  return `${GITLAB_CI_HEADER}${renderGitLabCiJobs(governanceLevel)}`;
}

/** harness-check.yml 全文（落盘正文，冲突时打印的也是这一份） */
export const HARNESS_CHECK_WORKFLOW = `name: Harness Check

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  harness-check:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run harness check
        run: npx @dommaker/harness check

      - name: Run harness validate
        run: npx @dommaker/harness validate

      - name: Run harness passes-gate
        run: npx @dommaker/harness passes-gate
`;

/**
 * GitHub Actions job 片段（`init --print-snippets` 的片段视图，harness#153）
 *
 * 由上面的落盘正本裁出 `jobs:` 段之后的一切，**不是第二份手抄文本**——它曾独立存在并
 * 少掉 `validate` / `passes-gate` 两道门禁，照抄的用户拿到比同版本 `harness init` 弱一半
 * 的 CI（#103 判据的第三种形态）。形状与 GitLab 侧对仗：打印的是正本的 job 段。
 */
export const GITHUB_ACTIONS_SNIPPET = HARNESS_CHECK_WORKFLOW.slice(
  HARNESS_CHECK_WORKFLOW.indexOf('  harness-check:'),
);

/**
 * 治理 CI 面正文
 *
 * `minimal` 档不带 docs 新鲜度检查（其余档位带，且失败不阻断）。平台只改变接线形状，
 * 三条命令与档位语义一致（harness#143）：GitLab 侧的「失败不阻断」= `allow_failure: true`，
 * 且因每个任务都是全新容器，docs 检查单列一个任务而非 GH 的一个 step。
 */
export function renderGovernanceWorkflow(level: string, platform: CiPlatform): string {
  if (platform === 'gitlab') {
    const docsJob = level === 'minimal'
      ? ''
      : `
harness-docs-freshness:
  stage: test
  script:
    - npm ci
    - npx @dommaker/harness sync-docs --check
${GITLAB_RULES}  allow_failure: true
`;
    return `harness-governance:
  stage: test
  script:
    - npm ci
    - npx @dommaker/harness check
    - npx @dommaker/harness passes-gate
${GITLAB_RULES}${docsJob}`;
  }

  const docsCheckStep = level !== 'minimal'
    ? `
      - name: Check docs freshness
        run: npx @dommaker/harness sync-docs --check
        continue-on-error: true`
    : '';

  return `name: Harness Governance

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  governance:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Constraint check
        run: npx @dommaker/harness check

      - name: Quality gate
        run: npx @dommaker/harness passes-gate
${docsCheckStep}
`;
}

/** custom-constraints.yml 示例正文 */
export const CUSTOM_CONSTRAINTS_TEMPLATE = `# 自定义约束配置
#
# 此文件定义项目特定的约束，扩展或覆盖 harness 内置约束

# ========================================
# 自定义约束示例
# ========================================

custom_constraints:
  # 示例 1：禁止 console.log
  # my_project_no_console_log:
  #   id: my_project_no_console_log
  #   level: guideline
  #   rule: "NO CONSOLE.LOG IN PRODUCTION CODE"
  #   message: "生产代码禁止使用 console.log，请使用 logger 模块"
  #   trigger: ["code_implementation"]
  #   description: "使用项目统一的 logger 模块代替 console.log"

  # 示例 2：禁止特定的导入
  # my_project_no_moment_js:
  #   id: my_project_no_moment_js
  #   level: guideline
  #   rule: "NO MOMENT.JS IMPORTS"
  #   message: "禁止使用 moment.js，请使用 date-fns 或 dayjs"
  #   trigger: ["code_implementation"]

  # 示例 3：要求特定的文件命名
  # my_project_component_naming:
  #   id: my_project_component_naming
  #   level: tip
  #   rule: "REACT COMPONENTS SHOULD BE PASCAL CASE"
  #   message: "React 组件文件名应使用 PascalCase"
  #   trigger: ["file_creation"]
`;

/** CHANGELOG.md 正文（`format` 来自治理配置的 changelog.format） */
export function renderChangelog(format: string): string {
  return format === 'keep-a-changelog'
    ? `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project setup with harness governance

---

> 此文件可由 \`harness sync-docs\` 辅助维护
`
    : `# Changelog

## [Unreleased]

- Initial project setup with harness governance

---

> 此文件可由 \`harness sync-docs\` 辅助维护
`;
}

/** 目录 CONTEXT.md 骨架正文（`dir` 是相对项目根的目录路径） */
export function renderContextDoc(dir: string): string {
  const dirName = path.basename(dir);
  return `# ${dirName}

> 此文件描述 ${dir} 目录的职责和上下文
> 请阅读本目录的源代码，然后填写以下各节。
> 如果使用 AI 编码助手，将本文件内容作为 prompt 请求它分析并填写。

## 职责

<!-- 本目录的核心职责是什么 -->

## 核心导出

<!-- 本目录对外暴露的主要模块/函数 -->

## 依赖关系

<!-- 本目录依赖哪些其他模块，谁依赖本目录 -->

## 注意事项

<!-- 开发时需要注意的约束或约定 -->
`;
}

/**
 * 默认检查点列表
 *
 * 注：no-console 检查点已移除（工单 23/24）——CLI 产品 src/ 必然有合法 console 输出，
 * 且旧配置 expected:'' 语义恒错；output_* 族修复为真正执行 config.command 后该检查会恒失败。
 */
export const DEFAULT_CHECKPOINTS: Checkpoint[] = [
  {
    id: 'build-success',
    name: '构建成功',
    checks: [
      {
        id: 'build-command',
        type: 'command_success',
        config: { command: 'npm run build' },
        message: '构建命令必须成功执行',
      },
    ],
  },
  {
    id: 'test-pass',
    name: '测试通过',
    checks: [
      {
        id: 'test-command',
        type: 'command_success',
        config: { command: 'npm test' },
        message: '测试命令必须成功执行',
      },
    ],
  },
];

/** 检查点文件的相对路径约定（validate 的缺省读取面与 init 的落盘面同一处） */
export const DEFAULT_CHECKPOINT_FILE = '.harness/checkpoints.yml';

/** checkpoints.yml 正文 */
export function renderCheckpoints(): string {
  return yaml.dump({ checkpoints: DEFAULT_CHECKPOINTS }, { indent: 2 });
}

/** 默认 Resolutions（RKB — 约束 → 已知解法映射） */
const DEFAULT_RESOLUTIONS = {
  no_fuzzy_completion_claim: {
    title: 'commit message 缺少验证证据',
    fix: '在 commit message body 中附上验证输出:\n`npx @dommaker/harness check --staged` | `npx @dommaker/harness validate` | `npm test -- --coverage`\n确认全部通过后重新 commit。',
  },
  capability_sync: {
    title: '缺少 CAPABILITIES.md',
    fix: '在项目根目录创建 CAPABILITIES.md，列出所有模块能力清单。运行 `npx @dommaker/harness sync-docs` 可自动生成模板。',
  },
  context_doc_sync: {
    title: '关键目录缺少 CONTEXT.md',
    fix: '在 required_dirs 目录下创建 CONTEXT.md。运行 `npx @dommaker/harness sync-docs` 可自动生成模板。',
  },
};

/** resolutions.json 正文 */
export function renderResolutions(): string {
  return JSON.stringify(DEFAULT_RESOLUTIONS, null, 2);
}
