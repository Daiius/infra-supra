import type { FeedUser } from '../../shared/feed';

export function UserCard({ user }: { user: FeedUser }) {
  return (
    <section className="card user-card">
      <h1>{user.name}</h1>
      <p className="meta">@{user.handle}</p>
      <p>{user.bio}</p>
      <ul className="counts">
        <li>
          <strong>{user.posts}</strong> posts
        </li>
        <li>
          <strong>{user.followers}</strong> followers
        </li>
        <li>
          <strong>{user.following}</strong> following
        </li>
      </ul>
    </section>
  );
}
