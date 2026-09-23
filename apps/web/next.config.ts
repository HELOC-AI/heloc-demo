import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@heloc/contracts', '@heloc/ops'],
};

export default config;
