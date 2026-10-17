import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import '@/styles/globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';

export default async function RootElement({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head></head>
      <body data-version="1.0" className="flex flex-col min-h-screen">
        <Provider>
          <TooltipProvider>{children}</TooltipProvider>
        </Provider>
      </body>
    </html>
  );
}

export async function getConfig() {
  return {
    render: 'static',
  } as const;
}
