import type { ReactNode } from 'react';
import { Navbar } from '@/components/layout/Navbar';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
