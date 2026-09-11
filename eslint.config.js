import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/drizzle/**', 'data/**'] },
  {
    files: ['packages/*/src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
  },
);
