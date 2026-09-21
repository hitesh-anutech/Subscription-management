import { DocumentsBrowser } from './_components/documents-browser';
import { getCurrentUser } from '@/lib/auth';

export const metadata = { title: 'Quotes & Invoices' };

export default async function DocumentsPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'Admin';

  return (
    <div className="space-y-3">
      <DocumentsBrowser isAdmin={isAdmin} />
    </div>
  );
}
