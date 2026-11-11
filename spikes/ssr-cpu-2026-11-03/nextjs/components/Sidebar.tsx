import type { FeedPage } from '../../shared/feed';

export function Sidebar({
  trendingTags,
  suggested,
}: {
  trendingTags: FeedPage['trendingTags'];
  suggested: FeedPage['suggested'];
}) {
  return (
    <aside className="sidebar">
      <section className="card">
        <h3>Trending</h3>
        <ol>
          {trendingTags.map((t) => (
            <li key={t.tag}>
              <a href={`/t/${t.tag}`}>#{t.tag}</a>{' '}
              <span className="meta">{t.count} posts</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="card">
        <h3>Who to follow</h3>
        <ul>
          {suggested.map((s) => (
            <li key={s.handle}>
              <a href={`/u/${s.handle}`}>{s.name}</a>{' '}
              <span className="meta">@{s.handle}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
