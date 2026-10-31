// 動きの要素（D-25・prd/07 §11.11）。演出だけで、ゲームの状態・ロジックには触れない。
// prefers-reduced-motion: reduce では動かさない（数字は即時・花火は出さない。CSS の動きは styles.css で止める）。
import { useEffect, useRef, useState } from 'react';

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
  life: number;
  color: string;
};

/** 祝いの花火の色（状態の色と混ぜないよう、系列の色の役割は使わない明るい色）。 */
const COLORS = ['#f6c344', '#ef7d57', '#5ec6e8', '#9d7ff2', '#7fd18b'];

/**
 * 目標達成の花火（canvas・依存なし）。数秒で消え、画面の操作を妨げない（pointer-events: none）。
 * 動きを減らす設定では何も出さない。
 */
export function Fireworks({ duration = 4500 }: { duration?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (reduced) return;
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
    const particles: Particle[] = [];
    // 演出の乱数（ゲームの乱数とは無関係）
    const burst = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w * (0.2 + Math.random() * 0.6);
      const cy = h * (0.15 + Math.random() * 0.35);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const sp = 2 + Math.random() * 2.5;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          color,
        });
      }
    };
    const start = performance.now();
    let lastBurst = -Infinity;
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      if (t < duration - 1500 && now - lastBurst > 450) {
        burst();
        lastBurst = now;
      }
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
        p.vx *= 0.985;
        p.life -= 0.012;
        if (p.life <= 0) continue;
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = particles.length - 1; i >= 0; i--)
        if (particles[i]!.life <= 0) particles.splice(i, 1);
      if (t < duration || particles.length) raf = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [reduced, duration]);
  if (reduced || done) return null;
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
