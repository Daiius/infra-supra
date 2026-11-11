// リクエストごとに描画する（静的に書き出さない・キャッシュしない）。
// searchParams を読むので本来も動的だが、明示しておく。
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import type { Metadata } from 'next';
import { buildFeedPage, parseItems } from '../../../shared/feed';
import { Header } from '../../components/Header';
import { UserCard } from '../../components/UserCard';
import { FeedItem } from '../../components/FeedItem';
import { Sidebar } from '../../components/Sidebar';
import { Footer } from '../../components/Footer';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function load(searchParams: SearchParams) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.items) ? sp.items[0] : sp.items;
  return buildFeedPage(parseItems(raw));
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const page = await load(searchParams);
  return { title: `Feed · ${page.user.name}` };
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const page = await load(searchParams);
  return (
    <>
      <Header nav={page.nav} user={page.user} />
      <div className="layout">
        <main>
          <UserCard user={page.user} />
          <section className="feed" aria-label="Feed">
            {page.items.map((item) => (
              <FeedItem key={item.id} item={item} />
            ))}
          </section>
        </main>
        <Sidebar trendingTags={page.trendingTags} suggested={page.suggested} />
      </div>
      <Footer links={page.footerLinks} />
    </>
  );
}
