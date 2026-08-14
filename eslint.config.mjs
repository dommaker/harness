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
];
