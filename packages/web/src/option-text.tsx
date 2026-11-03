// 選択肢の文の組み方（狭い画面でも句の途中で折れないように）。
// 1 行目 = 名前 + ⓘ（ⓘ は名前の最後の語とくっつけて、ⓘ だけが次の行に落ちない）、
// 2 行目 = 小さめのメタ情報（手間・期間・来月から など）を「・」区切りで。各句は途中で折れず、句の境で折れる。
import { Fragment, type ReactNode } from 'react';

/** 名前の最後の語と ⓘ をくっつける。 */
/** ⓘ と一緒に折り返さない末尾の長さ（文字。これより長い最後の語は、末尾のこの文字数だけを ⓘ に付ける）。 */
export const INFO_TAIL_CHARS = 4;

/**
 * 名前を「折り返してよい頭」と「ⓘ と離さない末尾」に分ける。末尾は最後の空白の後の語で、長ければ（日本語の続く文など）
 * 最後の INFO_TAIL_CHARS 文字だけにする（長い語を nowrap にすると狭い幅ではみ出すため）。
 */
export function splitForInfo(name: string): [string, string] {
  const i = name.lastIndexOf(' ');
  const chars = [...name.slice(i + 1)];
  const cut =
    chars.length > INFO_TAIL_CHARS ? chars.length - INFO_TAIL_CHARS : 0;
  const tail = chars.slice(cut).join('');
  return [name.slice(0, name.length - tail.length), tail];
}

export function NameWithInfo({
  name,
  info,
}: {
  name: string;
  info?: ReactNode;
}) {
  if (!info) return <>{name}</>;
  const [head, last] = splitForInfo(name);
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

/** 選択肢の 2 行の文（名前 + ⓘ / メタ情報）と、選べない理由（あれば 3 行目）・選ぶ前に知らせる注意（あれば最後）。 */
export function OptionText({
  name,
  meta = [],
  info,
  why,
  notice,
}: {
  name: string;
  meta?: string[];
  info?: ReactNode;
  why?: string | null;
  /** 選ぶと起きること（乗り換えで既定に戻る描き方など。D-107 の補足）。 */
  notice?: string | null;
}) {
  return (
    <span className="block">
      <span className="block">
        <NameWithInfo name={name} info={info} />
      </span>
      {meta.length > 0 && <Meta items={meta} />}
      {why && <span className="block text-xs">{why}</span>}
      {notice && (
        <span className="block text-xs text-warning" role="note">
          {notice}
        </span>
      )}
    </span>
  );
}
