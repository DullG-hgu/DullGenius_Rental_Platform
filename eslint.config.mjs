import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    { ignores: ['build/**', 'dist/**', 'coverage/**', 'node_modules/**'] },
    {
        files: ['src/**/*.{js,jsx}', 'tests/**/*.{js,jsx}', '*.config.{js,mjs}'],
        plugins: { 'react-hooks': reactHooks },
        linterOptions: { reportUnusedDisableDirectives: false },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-dupe-args': 'error',
            'no-dupe-keys': 'error',
            'no-constant-binary-expression': 'error',
            'valid-typeof': 'error',
            'react-hooks/rules-of-hooks': 'error',
        },
    },
    {
        files: ['netlify/functions/**/*.js', 'scripts/validate_env.mjs', 'scripts/validate_supabase_refs.mjs'],
        languageOptions: { globals: globals.node, ecmaVersion: 'latest' },
        rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-keys': 'error' },
    },
];
