import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from './_components/login-form';

export const metadata = { title: 'Login — Subscription Management' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { from?: string; error?: string };
}) {
  // Already logged in → redirect to dashboard
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <div className="relative min-h-screen bg-slate-900 flex items-center justify-center p-4 overflow-hidden">
      {/* Decorative Glow Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute top-[30%] right-[20%] w-[30%] h-[30%] rounded-full bg-pink-500/10 blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 mb-4 shadow-lg shadow-blue-500/20 hover:scale-105 transition-transform duration-300">
            <span className="text-white text-3xl font-extrabold tracking-tight">E</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Excel Technologies</h1>
          <p className="text-sm text-slate-400 mt-1.5 font-medium">Subscription Management Tool</p>
        </div>

        <LoginForm from={searchParams.from} />
      </div>
    </div>
  );
}

