import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/drizzle/**', 'data/**'] },
  {
    files: ['packages/*/src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // 下划线前缀 = 有意忽略的占位(如 mock 回调的未消费参数)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
