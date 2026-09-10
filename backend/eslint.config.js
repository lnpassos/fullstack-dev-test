// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Type-aware linting.
 *
 * The rules enabled beyond the recommended sets are the ones that catch the
 * mistakes this codebase is actually exposed to: a forgotten `await` on a
 * provider call, an error swallowed by a bare `catch`, a promise handed to
 * Express as a middleware. `strictTypeChecked` needs real type information,
 * which is why `projectService` is on.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      // A separate npm package with its own dependencies and its own typecheck.
      // Linting it from here needs `firebase-functions` resolvable, which it is
      // not unless someone has installed that package — so a clean clone would
      // fail this gate for a reason that has nothing to do with the code.
      'functions/**',
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A floating promise here means an unawaited provider call or an
      // unhandled rejection that takes the process down.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Unused values are usually a half-finished refactor; `_`-prefixed
      // parameters are the deliberate exception (Express signatures need them).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Errors are classified, never discarded.
      '@typescript-eslint/only-throw-error': 'error',
      'no-console': ['error', { allow: ['error'] }],

      // Interpolating a number into a message is normal and safe; the rule's
      // default forbids it to catch `${someObject}`, which is the case worth
      // keeping.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  /**
   * Layering, enforced rather than documented.
   *
   * Dependencies point inward: domain knows nothing, application knows only the
   * domain and its own ports, and only the composition root names both a port
   * and an implementation. This was a real violation before it was a rule — the
   * use case imported the fallback table and the prompt version directly — so
   * it is worth a lint error rather than a paragraph nobody re-reads.
   */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/application/**', '**/adapters/**'],
              message:
                'The domain layer must not depend on anything outside itself. Move the shared piece into shared/, or invert the dependency with a port.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message:
                'The application layer depends on ports, never on a concrete adapter. Declare a port in application/ports and inject the implementation in bootstrap.ts.',
            },
          ],
        },
      ],
    },
  },

  {
    // `shared/` holds dependency-free helpers that any layer may use. It earns
    // that privilege by depending on nothing itself — the moment it imports a
    // layer, it stops being shared and becomes a hidden coupling between the
    // layers that use it.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/domain/**', '**/application/**', '**/adapters/**'],
              message:
                'shared/ must not depend on any layer. If it needs one, it belongs in that layer instead.',
            },
          ],
        },
      ],
    },
  },

  {
    // This file is not part of the TypeScript program, so type-aware rules have
    // no type information to work from.
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    // Tests parse an untyped YAML document and assert against provider mocks;
    // requiring full typing there would add noise without catching anything.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',

      // Test doubles are deliberately inert: a `sleep` that does not sleep and a
      // provider that throws synchronously are the point, not an oversight.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // One test rejects with an AbortSignal reason, which is not an Error.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
    },
  },
);
