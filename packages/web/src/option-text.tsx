// 選択肢の文の組み方（狭い画面でも句の途中で折れないように）。
// 1 行目 = 名前 + ⓘ（ⓘ は名前の最後の語とくっつけて、ⓘ だけが次の行に落ちない）、
// 2 行目 = 小さめのメタ情報（手間・期間・来月から など）を「・」区切りで。各句は途中で折れず、句の境で折れる。
import { Fragment, type ReactNode } from 'react';

/** 名前の最後の語と ⓘ をくっつける。 */
/** ⓘ と離さない末尾の最大の長さ（文字）。これより長いまとまりは nowrap にしない（幅 360 ではみ出さないように）。 */
export const INFO_TAIL_MAX_CHARS = 12;

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });

/** 文の最後の語（Intl.Segmenter の語の区切り。空白は含めない）。 */
function lastWord(text: string): string {
  const words = [...segmenter.segment(text)].filter(
    (s) => s.segment.trim() !== '',
  );
  const last = words[words.length - 1];
  return last ? text.slice(last.index) : '';
}

/**
 * 名前を「折り返してよい頭」と「ⓘ と離さない末尾」に分ける。末尾は最後の語（括弧で終わるなら「（オンデマンド）」のような
 * 括弧のまとまり全体。長すぎれば括弧の中の最後の語 + 閉じ括弧）。語の途中で分けない（日本語は文字の間で折れるので、
 * 分けた所で「オンデ／マンド」のように切れる）。長すぎるまとまり（INFO_TAIL_MAX_CHARS 超）は nowrap にしない（末尾は空）。
 */
export function splitForInfo(name: string): [string, string] {
  const fits = (t: string) => t !== '' && [...t].length <= INFO_TAIL_MAX_CHARS;
  let tail = '';
  if (name.endsWith('）')) {
    const open = name.lastIndexOf('（');
    const group = open >= 0 ? name.slice(open) : '';
    tail = fits(group) ? group : lastWord(name.slice(0, -1)) + '）';
  } else tail = lastWord(name);
  if (!fits(tail)) tail = '';
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
