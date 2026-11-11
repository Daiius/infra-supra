// HTML の大きさの内訳を出す（local-bench.sh から呼ぶ）。
//   node html-size.mjs <file.html>
// 全体 / <script> を除いた見える部分 / <script> 要素の合計 / そのうち self.__next_f（Next.js の RSC の埋め込み）。
// 正規表現で <script>…</script> を数えるだけの目安（中身に </script> が無い前提。RSC の埋め込みはエスケープされている）。
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node html-size.mjs <file.html>');
  process.exit(2);
}
const html = readFileSync(file);
const text = html.toString('utf8');
const bytes = (s) => Buffer.byteLength(s, 'utf8');

const scripts = text.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
const scriptBytes = scripts.reduce((n, s) => n + bytes(s), 0);
const nextF = scripts.filter((s) => s.includes('self.__next_f'));
const nextFBytes = nextF.reduce((n, s) => n + bytes(s), 0);

console.log(
  [
    `全体 ${html.length} B`,
    `script を除く ${html.length - scriptBytes} B`,
    `script ${scriptBytes} B（${scripts.length} 個）`,
    `うち self.__next_f ${nextFBytes} B（${nextF.length} 個）`,
  ].join('  '),
);
