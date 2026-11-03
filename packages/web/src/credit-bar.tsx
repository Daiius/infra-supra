// クレジットの消費のバー。全体を「使った額」として、クレジットの分を青、超えた分（従量で請求）を淡いオレンジで描く。
export function CreditBar({
  ratio,
  label,
  className = 'w-full',
}: {
  ratio: number;
  label: string;
  className?: string;
}) {
  const r = Number.isFinite(ratio) ? ratio : 1;
  const credit = r > 1 ? 100 / r : Math.max(0, r) * 100;
  return (
    <div
      className={`flex h-2 overflow-hidden rounded-full bg-base-300 ${className}`}
      role="img"
      aria-label={label}
    >
      <div
        data-part="credit"
        className="bg-info"
        style={{ width: `${credit}%` }}
      />
      {r > 1 && (
        <div
          data-part="over"
          className="bg-warning/40"
          style={{ width: `${100 - credit}%` }}
        />
      )}
    </div>
  );
}
