import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { previewEnabled } from './preview.ts';
import './styles.css';

// 開発中のシナリオの印（?preview=1 / 0。D-232）を、画面が URL を書き換える前に読んで覚える
previewEnabled();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
