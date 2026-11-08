// 動きの要素（D-25・prd/07 §11.11）。演出だけで、ゲームの状態・ロジックには触れない。
// prefers-reduced-motion: reduce では動かさない（数字は即時・花火は出さない。CSS の動きは styles.css で止める）。
import { useEffect, useEffectEvent, useRef, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** 動きを減らす設定か（設定の変更にも追従する）。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** 数字のカウントアップ（前の値から新しい値へ）。動きを減らす設定では即時。 */
export function CountUp({
  value,
  format,
  duration = 700,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(a + (value - a) * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, reduced, duration]);
  // 読み上げは最終の値（動いている途中の値を読ませない）
  return (
    <span aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 から 0 へ減る。0 で消える（粒ごとの寿命）。 */
  life: number;
  decay: number;
  color: string;
  size: number;
};

/** 暗い背景で映える明るい多色（状態の色・系列の色の役割とは別）。 */
const COLORS = [
  '#ffd166',
  '#ff5d8f',
  '#4cc9f0',
  '#b388ff',
  '#80ffdb',
  '#ff9f1c',
  '#ffffff',
];

/**
 * 花火の粒の集まり（演出の乱数を使う。ゲームの乱数とは無関係）。
 * ダイアログの中の canvas と、閉じた後の canvas で同じ粒を引き継ぐため、描画と分けて持つ。
 */
export class FireworksEngine {
  particles: Particle[] = [];

  burst(width: number, height: number, n = 70) {
    const cx = width * (0.15 + Math.random() * 0.7);
    const cy = height * (0.12 + Math.random() * 0.4);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
    const accent = COLORS[Math.floor(Math.random() * COLORS.length)]!;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const sp = 2.5 + Math.random() * 3.5;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.008 + Math.random() * 0.006,
        color: i % 4 === 0 ? accent : color,
        size: 2.4 + Math.random() * 1.6,
      });
    }
  }

  /** 1 コマ進めて描く。alpha は全体の不透明度（閉じた後は下げる）。 */
  step(ctx: CanvasRenderingContext2D, alpha: number) {
    for (const p of this.particles) {
      const px = p.x;
      const py = p.y;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.045;
      p.vx *= 0.982;
      p.vy *= 0.982;
      p.life -= p.decay;
      if (p.life <= 0) continue;
      ctx.globalAlpha = alpha * p.life;
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      // 尾: 少し前の位置から今の位置へ
      ctx.lineWidth = p.size * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px - (p.x - px) * 3, py - (p.y - py) * 3);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    ctx.globalAlpha = 1;
  }
}

/**
 * 花火の段（1〜3）ごとの打ち上げの間隔（ms）と 1 発の粒の数。段が上がるほど多く・速く打ち上げる
 * （段は自己ベストを更新した軸の数で決める。D-145・prd/15 ST-01 の暫定）。
 */
const FIREWORK_LEVELS = {
  1: { intervalMs: 650, particles: 70 },
  2: { intervalMs: 420, particles: 90 },
  3: { intervalMs: 260, particles: 110 },
} as const;

/**
 * 花火を描く canvas（画面全体・操作を妨げない）。spawn の間は新しい花火を打ち上げ、
 * spawn でなくなったら残りの粒が寿命で消えるまで描き、空になったら onEmpty を呼ぶ。
 */
export function FireworksCanvas({
  engine,
  spawn,
  alpha = 1,
  level = 1,
  className,
  onEmpty,
}: {
  engine: FireworksEngine;
  spawn: boolean;
  alpha?: number;
  /** 花火の段（1〜3）。 */
  level?: 1 | 2 | 3;
  className: string;
  onEmpty?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 最新の onEmpty を effect から呼ぶ（render 中に ref へ書くと React Compiler が最適化を諦めるので useEffectEvent）
  const empty = useEffectEvent(() => onEmpty?.());
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    let last = -Infinity;
    let raf = 0;
    const tick = (now: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const lv = FIREWORK_LEVELS[level];
      if (spawn && now - last > lv.intervalMs) {
        engine.burst(w, h, lv.particles);
        last = now;
      }
      ctx.clearRect(0, 0, w, h);
      engine.step(ctx, alpha);
      if (spawn || engine.particles.length > 0)
        raf = requestAnimationFrame(tick);
      else empty();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [engine, spawn, alpha, level]);
  return <canvas ref={ref} aria-hidden className={className} />;
}
