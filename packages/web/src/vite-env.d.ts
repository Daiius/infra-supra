/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 集計のサーバーに終わったプレイを送るか（D-152）。'true' か '1' のときだけ送る。
   * サーバー（packages/stats）と Vercel の中継（vercel.ts の API_ORIGIN）を用意した後に Vercel の環境変数で立てる（prd/15 §7.1）。
   */
  readonly VITE_STATS_ENABLED?: string;
}
