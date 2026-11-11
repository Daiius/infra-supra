import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // 計測に不要なバインディング（セッション用の KV・Images）を作らせない。
  // 既定のままだと deploy 時に KV namespace の自動作成が走る。
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
});
