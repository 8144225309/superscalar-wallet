import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow the `const { secret, ...safe } = obj` strip-field idiom used
      // by controllers/nodes.ts and similar — without this option ESLint
      // flags the deliberately-named-and-discarded key (e.g. `rune`) as
      // an unused variable.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
];
