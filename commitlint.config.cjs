module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'revert'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'backend',
        'frontend',
        'shared',
        'mobile', // feature:native-core
        'packages',
        'root',
        'docs',
        'husky',
        'lint-staged',
      ],
    ],
    'subject-case': [0], // Allow any case in subject
    'subject-max-length': [2, 'always', 100],
    'body-max-line-length': [0], // Disable body max line length
  },
};
