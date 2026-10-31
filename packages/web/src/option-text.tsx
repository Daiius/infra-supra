// 選択肢の文の組み方（狭い画面でも句の途中で折れないように）。
// 1 行目 = 名前 + ⓘ（ⓘ は名前の最後の語とくっつけて、ⓘ だけが次の行に落ちない）、
// 2 行目 = 小さめのメタ情報（手間・期間・来月から など）を「・」区切りで。各句は途中で折れず、句の境で折れる。
import { Fragment, type ReactNode } from 'react';

/** 名前の最後の語と ⓘ をくっつける。 */
export function NameWithInfo({
  name,
  info,
}: {
  name: string;
  info?: ReactNode;
}) {
  if (!info) return <>{name}</>;
  const i = name.lastIndexOf(' ');
  const head = i >= 0 ? name.slice(0, i + 1) : '';
  const last = i >= 0 ? name.slice(i + 1) : name;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {last}
        {' '}
        {info}
      </span>
    </>
  );
}

/** 「・」区切りのメタ情報。句ごとに折れず、句の境（・の後）で折れる。 */
export function Meta({
  items,
  className = 'block text-xs opacity-70',
}: {
  items: string[];
  className?: string;
}) {
  return (
    <span className={className}>
      {items.map((m, i) => (
        <Fragment key={m}>
          {i > 0 && (
            <>
              ・<wbr />
            </>
          )}
          <span className="whitespace-nowrap">{m}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** 選択肢の 2 行の文（名前 + ⓘ / メタ情報）と、選べない理由（あれば 3 行目）。 */
export function OptionText({
  name,
  meta = [],
  info,
  why,
}: {
  name: string;
  meta?: string[];
  info?: ReactNode;
  why?: string | null;
}) {
  return (
    <span className="block">
      <span className="block">
        <NameWithInfo name={name} info={info} />
      </span>
      {meta.length > 0 && <Meta items={meta} />}
      {why && <span className="block text-xs">{why}</span>}
    </span>
  );
}
