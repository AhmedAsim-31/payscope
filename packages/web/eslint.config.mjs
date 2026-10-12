import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import rootConfig from '../../eslint.config.mjs';

export default [
  ...rootConfig,
  nextPlugin.configs['core-web-vitals'],
  reactHooks.configs.flat.recommended,
  { ignores: ['.next/**', 'next-env.d.ts'] },
];
