import type { FeedPage } from '../../shared/feed';

export function Footer({ links }: { links: FeedPage['footerLinks'] }) {
  return (
    <footer className="site-footer">
      <nav aria-label="Footer">
        {links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </nav>
      <p>© 2026 InfraSupra Social (measurement spike)</p>
    </footer>
  );
}
