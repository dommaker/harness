/**
 * ESLint flat config（issue #35）。
 *
 * 背景：仓库自初始提交起无任何 ESLint 配置，`npm run lint` 恒失败。
 * eslint 8.57 起自动识别本文件（flat config），无需升级 eslint、无需环境变量。
 *
 * 规则集 = eslint:recommended + @typescript-eslint/recommended 的收敛版：
 * - 已启用并全绿（CI lint job 把关，见 .github/workflows/coverage-gate.yml）。
 * - 下方显式 off 的规则为存量规模大或有刻意用途，开启即全红；专项治理另开票：
 *   - no-explicit-any / no-non-null-assertion：存量 335 / 252 处，属风格化改型，一次性清洗风险高。
 *   - no-var-requires：仓内刻意使用 CJS 懒加载 require（测试隔离、避免循环依赖），转 import 有行为风险。
 *   - require-yield：src/llm/adapter.ts 的 async generator stub 故意抛错、无 yield 语义。
 * - no-empty：catch {} 吞异常是既有约定，保留（allowEmptyCatch）。
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
      'require-yield': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
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
