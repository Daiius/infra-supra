// og.html の入口（D-191）。OGP の画像の元の箱（og-card.tsx）だけを左上に描く。dev でだけ開く（build の input に入れていない）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OgCard } from './og-card.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OgCard />
  </StrictMode>,
);
