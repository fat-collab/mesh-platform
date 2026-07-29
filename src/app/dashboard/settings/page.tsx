import { ShopIntakeForm } from '@/components/onboarding/ShopIntakeForm';

export default function ShopSettingsPage() {
  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <header className="mb-5">
          <h1 className="text-xl font-bold tracking-tight">Shop Profile &amp; SOP Setup</h1>
          <p className="text-sm text-zinc-400">
            Configure shop details, operating hours, staff roster, PDR matrix, and the
            engagement agreement.
          </p>
        </header>
        <ShopIntakeForm />
      </div>
    </div>
  );
}
