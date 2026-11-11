// 小さな選択のチップ（aria-pressed のボタンの組）。結果の画面の絞り込み（D-175）・分布の切り替え（D-204）などで共用する。

/** 小さな選択のチップ（1 つだけ選ぶ）。 */
export function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  /** data-chips の値（テストと見た目の確かめ用）。 */
  name: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-chips={name}
      className="flex min-w-0 flex-wrap gap-1"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            data-chip={o.value}
            title={o.title ?? o.label}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              selected
                ? 'bg-primary/10 font-medium ring-2 ring-primary ring-inset'
                : 'cursor-pointer bg-base-100 ring-1 ring-base-300 ring-inset hover:bg-base-200'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
