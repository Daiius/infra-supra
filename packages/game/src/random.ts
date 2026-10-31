// シード付き乱数（prd/07 §10.5）。四則演算とビット演算だけなので、どの JS エンジンでも同じ列になる。

/** mulberry32。[乱数 0〜1, 次の内部状態] を返す。 */
export function nextRandom(seed: number): [number, number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** FNV-1a（32 bit）。出来事ごとに独立した乱数の列を作るために、id とシードを混ぜる。 */
export function hashSeed(seed: number, key: string): number {
  let h = 0x811c9dc5 ^ (seed | 0);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** 列 key から n 個の乱数を引く（出来事を足しても、他の出来事の時期が変わらない）。 */
export function draws(seed: number, key: string, n: number): number[] {
  let s = hashSeed(seed, key);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [r, next] = nextRandom(s);
    out.push(r);
    s = next;
  }
  return out;
}
