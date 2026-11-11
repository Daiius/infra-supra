// 両アプリ（astro / vinext）が同じものを import する、決定論的なダミーデータ。
// fetch も DB も使わないので、計測される CPU 時間はほぼ描画だけになる。
// 1 リクエストごとに作り直す（データ生成の CPU も両者で同じだけ乗る）。

export interface FeedUser {
  handle: string;
  name: string;
  bio: string;
  followers: number;
  following: number;
  posts: number;
}

export interface FeedItem {
  id: string;
  title: string;
  excerpt: string;
  author: { handle: string; name: string };
  date: string; // YYYY-MM-DD HH:MM（Intl を使わず固定の書式）
  tags: string[];
  likes: number;
  comments: number;
  reposts: number;
  topComment: { handle: string; name: string; text: string };
}

export interface FeedPage {
  user: FeedUser;
  nav: { href: string; label: string }[];
  items: FeedItem[];
  trendingTags: { tag: string; count: number }[];
  suggested: { handle: string; name: string }[];
  footerLinks: { href: string; label: string }[];
}

/** 両アプリで同じ <style> を head に入れる（Astro のスコープ付き CSS の属性を避けるため文字列で共有）。 */
export const PAGE_CSS =
  'body{margin:0;font-family:system-ui,sans-serif;color:#222;background:#f6f6f6}' +
  '.site-header{display:flex;justify-content:space-between;padding:12px 24px;background:#fff;border-bottom:1px solid #ddd}' +
  '.site-nav a{margin-right:12px;color:#333;text-decoration:none}' +
  '.layout{display:grid;grid-template-columns:1fr 280px;gap:24px;max-width:1100px;margin:24px auto;padding:0 16px}' +
  '.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px}' +
  '.feed-item h2{font-size:1.1rem;margin:0 0 8px}.meta{color:#666;font-size:.85rem}' +
  '.tags{list-style:none;padding:0;display:flex;gap:6px}.tag{background:#eef;border-radius:4px;padding:2px 6px;font-size:.8rem}' +
  '.counts{display:flex;gap:16px;color:#555;font-size:.85rem}.site-footer{text-align:center;padding:24px;color:#777}' +
  '.avatar{display:inline-block;width:32px;height:32px;border-radius:50%;background:#ccd;text-align:center;line-height:32px}' +
  '.actions{display:flex;gap:8px;margin-top:8px}.action{border:1px solid #ddd;background:#fff;border-radius:4px;padding:4px 8px}' +
  '.top-comment{border-left:3px solid #ddd;padding-left:8px;margin-top:8px;font-size:.9rem}';

export const DEFAULT_ITEMS = 10;
export const MAX_ITEMS = 200;

/** `?items=N` を 1〜MAX_ITEMS に丸める。不正値は既定値。 */
export function parseItems(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_ITEMS;
  return Math.min(n, MAX_ITEMS);
}

// mulberry32: シード付きの小さな PRNG（決定論）
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'edge cache render server client stream worker latency bundle route page ' +
  'component state data query index schema deploy region request response ' +
  'header cookie session token build static dynamic island hydrate payload ' +
  'memory budget limit quota price tier plan usage metric trace log sample ' +
  'design layout grid card list feed post comment like share follow profile'
).split(' ');

const NAMES = [
  'Aoi Sato',
  'Haruto Suzuki',
  'Yui Takahashi',
  'Sota Tanaka',
  'Mio Watanabe',
  'Riku Ito',
  'Hina Yamamoto',
  'Ren Nakamura',
  'Sakura Kobayashi',
  'Kaito Kato',
];

const TAGS = [
  'webdev',
  'cloudflare',
  'react',
  'astro',
  'nextjs',
  'performance',
  'css',
  'typescript',
  'database',
  'devops',
  'design',
  'testing',
  'security',
  'rust',
];

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function sentence(r: () => number, minChars: number): string {
  let s = '';
  while (s.length < minChars) {
    const w = pick(r, WORDS);
    s += s.length === 0 ? w[0]!.toUpperCase() + w.slice(1) : ' ' + w;
    if (r() < 0.12) s += '.';
  }
  return s.endsWith('.') ? s : s + '.';
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function formatDate(epochMinutes: number): string {
  const d = new Date(epochMinutes * 60_000);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

function handleOf(name: string): string {
  return name.toLowerCase().replace(' ', '_');
}

const BASE_MINUTES = Date.UTC(2026, 10, 3, 9, 0) / 60_000;

export function buildFeedPage(itemCount: number, seed = 42): FeedPage {
  const r = rng(seed);
  const userName = 'Alex Example';
  const items: FeedItem[] = [];
  for (let i = 0; i < itemCount; i++) {
    const name = pick(r, NAMES);
    const tagCount = 2 + Math.floor(r() * 3);
    const tags: string[] = [];
    for (let t = 0; t < tagCount; t++) tags.push(pick(r, TAGS));
    items.push({
      id: `post-${i + 1}`,
      title: sentence(r, 40).replace(/\.$/, ''),
      excerpt: sentence(r, 300),
      author: { handle: handleOf(name), name },
      date: formatDate(BASE_MINUTES - i * 97),
      tags,
      likes: Math.floor(r() * 500),
      comments: Math.floor(r() * 80),
      reposts: Math.floor(r() * 40),
      topComment: (() => {
        const c = pick(r, NAMES);
        return { handle: handleOf(c), name: c, text: sentence(r, 150) };
      })(),
    });
  }
  return {
    user: {
      handle: handleOf(userName),
      name: userName,
      bio: sentence(r, 120),
      followers: 1234,
      following: 321,
      posts: 87,
    },
    nav: [
      { href: '/feed', label: 'Home' },
      { href: '/explore', label: 'Explore' },
      { href: '/notifications', label: 'Notifications' },
      { href: '/messages', label: 'Messages' },
      { href: '/bookmarks', label: 'Bookmarks' },
      { href: '/settings', label: 'Settings' },
    ],
    items,
    trendingTags: TAGS.slice(0, 10).map((tag, i) => ({
      tag,
      count: 1000 - i * 73,
    })),
    suggested: NAMES.slice(0, 5).map((name) => ({
      handle: handleOf(name),
      name,
    })),
    footerLinks: [
      { href: '/about', label: 'About' },
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/help', label: 'Help' },
    ],
  };
}
