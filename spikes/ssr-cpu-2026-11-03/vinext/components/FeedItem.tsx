import type { FeedItem as Item } from '../../shared/feed';

export function FeedItem({ item }: { item: Item }) {
  const actions = [
    { kind: 'like', label: 'Like', icon: '♥', count: item.likes },
    { kind: 'comment', label: 'Comment on', icon: '💬', count: item.comments },
    { kind: 'repost', label: 'Repost', icon: '↻', count: item.reposts },
    { kind: 'bookmark', label: 'Bookmark', icon: '☆', count: null },
    { kind: 'share', label: 'Share', icon: '↗', count: null },
  ];
  return (
    <article
      className="card feed-item"
      id={item.id}
      data-author={item.author.handle}
    >
      <header className="feed-item-header">
        <span className="avatar" aria-hidden="true">
          {item.author.name.slice(0, 1)}
        </span>
        <p className="meta">
          by <a href={`/u/${item.author.handle}`}>{item.author.name}</a>{' '}
          <span className="handle">@{item.author.handle}</span> ·{' '}
          <time dateTime={item.date}>{item.date}</time>
        </p>
      </header>
      <h2>
        <a href={`/p/${item.id}`}>{item.title}</a>
      </h2>
      <p className="excerpt">{item.excerpt}</p>
      <ul className="tags">
        {item.tags.map((t, i) => (
          <li key={i} className="tag">
            <a href={`/t/${t}`}>#{t}</a>
          </li>
        ))}
      </ul>
      <div className="counts">
        <span className="likes">{item.likes} likes</span>
        <span className="comments">{item.comments} comments</span>
      </div>
      <div className="actions" role="group" aria-label="Post actions">
        {actions.map((a) => (
          <button
            key={a.kind}
            type="button"
            className={`action action-${a.kind}`}
            aria-label={`${a.label} this post by ${item.author.name}`}
          >
            {a.icon}{' '}
            {a.count !== null && <span className="count">{a.count}</span>}
          </button>
        ))}
      </div>
      <blockquote className="top-comment">
        <a href={`/u/${item.topComment.handle}`}>{item.topComment.name}</a>
        <p>{item.topComment.text}</p>
      </blockquote>
    </article>
  );
}
