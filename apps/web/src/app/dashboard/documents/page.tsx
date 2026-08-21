import { DocumentsBrowser } from './_components/documents-browser';
import { getCurrentUser } from '@/lib/auth';

export const metadata = { title: 'Quotes & Invoices' };

export default async function DocumentsPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'Admin';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">🧾 Quotes &amp; Invoices</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Zoho Books se Quotes aur Invoices ka live data — filter karke fetch karein, columns customize karein, aur views save karein.
        </p>
      </div>
      <DocumentsBrowser isAdmin={isAdmin} />
    </div>
  );
}
