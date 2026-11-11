import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  // shared/feed.ts（このディレクトリの外）を import するので、トレースの根をスパイクのディレクトリにする。
  outputFileTracingRoot: fileURLToPath(new URL('..', import.meta.url)),
};

export default config;
