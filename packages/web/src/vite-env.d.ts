/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 集計のサーバーに終わったプレイを送るか（D-152）。'true' か '1' のときだけ送る。
   * サーバー（packages/stats）と Vercel の中継（vercel.ts の API_ORIGIN）を用意した後に Vercel の環境変数で立てる（prd/15 §7.1）。
   */
  readonly VITE_STATS_ENABLED?: string;
  /**
   * 開発用（`pnpm dev` のときだけ効く）: 'true' か '1' なら、サーバーに取りに行かず架空の分布（stats-mock.ts）で段 3 の画面を出す（D-164）。
   * 送信はしない。本番のビルド（import.meta.env.DEV が false）では読まない。
   */
  readonly VITE_STATS_MOCK?: string;
}
