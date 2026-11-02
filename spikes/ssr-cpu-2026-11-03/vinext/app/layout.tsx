import type { ReactNode } from 'react';
import { PAGE_CSS } from '../../shared/feed';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
