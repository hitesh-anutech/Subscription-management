import { CustomersBrowser } from './_components/customers-browser';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Customers' };

export default async function CustomersPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === 'Admin';
  return <CustomersBrowser isAdmin={isAdmin} />;
}
