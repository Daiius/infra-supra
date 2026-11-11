import type { FeedPage } from '../../shared/feed';

export function Header({
  nav,
  user,
}: {
  nav: FeedPage['nav'];
  user: FeedPage['user'];
}) {
  return (
    <header className="site-header">
      <a className="logo" href="/feed">
        InfraSupra Social
      </a>
      <nav className="site-nav" aria-label="Main">
        {nav.map((n) => (
          <a key={n.href} href={n.href}>
            {n.label}
          </a>
        ))}
      </nav>
      <a className="me" href={`/u/${user.handle}`}>
        @{user.handle}
      </a>
    </header>
  );
}
