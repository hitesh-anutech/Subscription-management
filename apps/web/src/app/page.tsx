import { redirect } from 'next/navigation';

export default function RootPage() {
  // Sprint 1: send directly to dashboard. Sprint 2 will add login redirect logic.
  redirect('/dashboard');
}
