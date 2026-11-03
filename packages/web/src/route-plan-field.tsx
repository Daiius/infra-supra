// 始める画面の ③ ページごとの描き方（D-107）。フレームワーク（②）の既定から、ページごとに描き方を選び直す。
// 行ごとに要件の判定（鮮度・SNS のカード・1 リクエストの CPU の制限）と、ほかの描き方にしたときの 1 か月目の差を出す。
// 始める前なので手間はかからない（途中で替えるときは手間がかかる。RS-08）。
import {
  partsOfComments,
  routePlanRows,
  routePlanStatus,
  STACKS,
  withRouteChoice,
  type FrameworkId,
  type RouteAlternative,
  type RouteOverrides,
  type RoutePlanRow,
  type Scenario,
} from 'game';
import { useMemo } from 'react';
import { ROUTE_PLAN_NOTE, RoutePlanTable } from './route-plan-table.tsx';

export function RoutePlanField({
  scenario,
  stackIndex,
  framework,
  components,
  revalidateSec,
  comments,
  routes,
  onChange,
  onCommentsChange,
}: {
  scenario: Scenario;
  stackIndex: number;
  framework: FrameworkId;
  components: Partial<Record<string, string>>;
  revalidateSec: number;
  /** 記事のページのコメント欄（ページの部品。D-82・D-109）。 */
  comments: number;
  routes: RouteOverrides;
  /** 選んだ描き方と、一緒に替える revalidateSec（S3 はオンデマンドなど。省略は今のまま）。 */
  onChange: (routes: RouteOverrides, revalidateSec?: number) => void;
  /** 記事の行のコメント欄を選ぶ（D-109）。 */
  onCommentsChange: (comments: number) => void;
}) {
  const chosen = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(components).filter(
          (x): x is [string, string] => x[1] !== undefined,
        ),
      ),
    [components],
  );
  const rows = useMemo(
    () =>
      routePlanRows(scenario, {
        framework,
        stackIndex,
        settings: { revalidateSec },
        components: chosen,
        routes,
        routeParts: partsOfComments(scenario, comments),
      }),
    [scenario, framework, stackIndex, revalidateSec, comments, chosen, routes],
  );
  const status = useMemo(
    () =>
      routePlanStatus(scenario, {
        framework,
        stackIndex,
        components: chosen,
        revalidateSec,
        comments,
        routes,
      }),
    [scenario, framework, stackIndex, chosen, revalidateSec, comments, routes],
  );
  const pick = (row: RoutePlanRow, alt: RouteAlternative) =>
    onChange(
      withRouteChoice(
        scenario,
        { framework, platform: STACKS[stackIndex]!.provider },
        routes,
        row.route,
        alt.strategy,
      ),
      alt.value,
    );
  return (
    <section aria-label="ページの描き方" className="mt-2 space-y-1">
      <h3 className="font-bold">ページの描き方</h3>
      <p className="text-xs opacity-70">
        フレームワークの既定から、ページごとに選び直せる。記事のページのコメント欄（HTML
        に含めるか、ブラウザで読み込むか）も行の中で選ぶ（始める前なので手間はかからない。途中で替えると手間がかかる）。
      </p>
      <RoutePlanTable
        rows={rows}
        status={status}
        onSelect={pick}
        onPart={(_, part, v) => {
          if (part === 'comments') onCommentsChange(v);
        }}
        caption={ROUTE_PLAN_NOTE}
      />
    </section>
  );
}
