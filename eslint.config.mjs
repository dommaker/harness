/**
 * ESLint flat config（issue #35）。
 *
 * 背景：仓库自初始提交起无任何 ESLint 配置，`npm run lint` 恒失败。
 * eslint 8.57 起自动识别本文件（flat config），无需升级 eslint、无需环境变量。
 *
 * 规则集 = eslint:recommended + @typescript-eslint/recommended 的收敛版：
 * - 已启用并全绿（CI lint job 把关，见 .github/workflows/coverage-gate.yml）。
 * - 下方显式 off 的规则为存量规模大或有刻意用途，开启即全红；专项治理另开票：
 *   - no-explicit-any：存量 31 处（非测试口径；含测试 172 处）。本阶段（吞错治理）
 *     先不开——any 清洗在 Phase 4 专项收口后再启用，避免与行为改动混票。
 *   - no-non-null-assertion：存量 21 处（非测试口径；含测试 291 处），随 any 同批治理。
 *   - no-var-requires：仓内刻意使用 CJS 懒加载 require（测试隔离、避免循环依赖，
 *     存量 33 处），转 import 有行为风险。
 * - require-yield：原豁免理由（src/llm/adapter.ts 的 async generator stub）随该文件
 *   删除而消失，实测零违规，已撤豁免回归 recommended 默认。
 * - no-empty（吞错治理收紧）：去掉 allowEmptyCatch——空 catch 直接报错。
 *   显式降级走 utils/attempt（调用点注明理由），存在性探测用 existsSync，
 *   不再允许 `catch {}` 静默吞。
 *
 * 第二段是分层方向规则（架构评审 2026-09-02 候选9 / harness#88）：此前
 * `types → utils → core → 领域层 → cli` 只写在 CLAUDE.md 里。规则只作用于
 * src/core/**——core 是唯一有历史上行债的层，收完即锁死；其余层的方向约束
 * 尚无零违规基线，扩大作用域会立刻全红，另开票治理。
 */
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      // TS 环境下由编译器/TS 版规则接管的核心规则
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      // 仓内约定：`_` 前缀参数 = 刻意未用（接口签名需保留）
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // ── 显式关闭（见文件头注释） ──
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-empty': 'error',
    },
  },
  {
    files: ['src/core/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // 单向分层：core 不得值导入上层（数据/能力由调用方经参数注入，harness#88）
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/cli', '**/cli/**',
                '**/gates', '**/gates/**',
                '**/monitoring', '**/monitoring/**',
              ],
              message:
                '分层 types → utils → core → 领域层 → cli：core 不得值导入 cli/gates/monitoring，' +
                '请由调用方注入所需数据（type-only 导入允许，harness#88）',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];
