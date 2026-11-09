// OGP の画像（1200×630。D-191）の元になる箱。og.html（dev でだけ開く入口）で描き、ブラウザでこの箱を撮って public/og.png にする。
// ロゴ（D-184）を大写しにし、背景に記事コミュニティのシナリオの図柄（D-140 の ScenarioArt）を全面に薄く写す。
// ロゴは入れ替えない（still）。括線・空きは em で決めているので、大きくしても比率は崩れない。テーマはライト（og.html の data-theme）。
import { Logo } from './logo.tsx';
import { ScenarioArt } from './scenario-art.tsx';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** ロゴの字の大きさ（px）。ロゴの高さは約 2.1em。 */
export const OG_LOGO_SIZE = 150;
/** 背景の図柄の不透明度。 */
export const OG_ART_OPACITY = 0.2;
/** 図柄の部品の素の幅（ScenarioArt の max-w-md = 28rem）。これを箱の幅まで拡大する。 */
const ART_BASE_WIDTH = 448;

export function OgCard() {
  return (
    <div
      data-og-card
      className="relative overflow-hidden bg-base-100 text-base-content"
      style={{ width: OG_WIDTH, height: OG_HEIGHT }}
    >
      {/* 背景の図柄。素の大きさ（幅 448px・12:5）で描いて箱の幅まで拡大し、上下の中央に置く。
          破線は拡大しても太くならない（non-scaling-stroke）ので、ここだけ太くして薄くしても見えるようにする */}
      <div
        aria-hidden
        data-og-art
        className="absolute top-1/2 left-1/2 [&_line]:[stroke-width:4]"
        style={{
          width: ART_BASE_WIDTH,
          opacity: OG_ART_OPACITY,
          transform: `translate(-50%, -50%) scale(${OG_WIDTH / ART_BASE_WIDTH})`,
        }}
      >
        <ScenarioArt scenarioId="article-community" name="記事コミュニティ" />
      </div>
      {/* ロゴの後ろだけ地の色を淡く戻し、図柄の中心の印とロゴが重なっても読めるようにする */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_34%_44%_at_50%_50%,var(--color-base-100)_40%,transparent_100%)]"
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-7">
        <Logo still size={OG_LOGO_SIZE} />
        <p className="text-[34px] font-medium tracking-wide text-base-content/70">
          Web アプリのインフラ運営シミュレーション
        </p>
      </div>
    </div>
  );
}
