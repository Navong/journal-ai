'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const isDevelopment = process.env.NODE_ENV === 'development';

  const handleTryDemo = () => {
    // Set demo mode cookie (expires in 24 hours)
    const expires = new Date();
    expires.setTime(expires.getTime() + 24 * 60 * 60 * 1000);
    document.cookie = `demo-mode=true; expires=${expires.toUTCString()}; path=/`;
    router.push('/');
    router.refresh();
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsLoading(true);
    try {
      await signIn('google', { callbackUrl: '/' });
    } catch (err) {
      setError('An error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setError('');
    setIsLoading(true);
    try {
      const result = await signIn('DevLogin', {
        redirect: false,
      });
      if (result?.error) {
        setError(`Dev login failed: ${result.error}`);
        setIsLoading(false);
      } else if (result?.ok !== false) {
        router.push('/');
        router.refresh();
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      setError(`An error occurred: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFCF8] flex items-center justify-center px-4 py-12 md:py-20">
      <div className="w-full max-w-sm">

        {/* Logo / Brand */}
        <div className="text-center mb-12 md:mb-16">
          <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 bg-emerald-50 rounded-full border border-emerald-100/80 shadow-sm mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 md:h-8 md:w-8 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h1 className="text-3xl md:text-4xl font-light text-stone-800 tracking-tight font-serif mb-2">
            Serenity
          </h1>
          <p className="text-stone-400 text-sm font-light tracking-wide">
            A quiet space for your thoughts.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-rose-50/60 border border-rose-200/60 rounded-2xl text-rose-700 text-sm font-light leading-relaxed">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full py-3.5 px-6 rounded-full bg-white border border-stone-200 hover:border-stone-300 hover:bg-stone-50/50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 focus:ring-offset-[#FDFCF8] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-3 text-stone-700 font-light text-sm shadow-sm"
          >
            <svg className="w-4.5 h-4.5 flex-shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            {isLoading ? 'Signing in...' : 'Continue with Google'}
          </button>

          {isDevelopment && (
            <button
              onClick={handleDevLogin}
              disabled={isLoading}
              className="w-full py-3.5 px-6 rounded-full border border-amber-200 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-[#FDFCF8] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 active:scale-[0.98] text-amber-800 font-light text-sm"
            >
              {isLoading ? 'Signing in...' : 'Dev Login'}
            </button>
          )}

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-stone-100"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-[#FDFCF8] text-[10px] text-stone-400 uppercase tracking-widest font-bold">or</span>
            </div>
          </div>

          <button
            onClick={handleTryDemo}
            disabled={isLoading}
            className="w-full py-3.5 px-6 rounded-full border border-stone-100 hover:border-stone-200 hover:bg-stone-50/30 focus:outline-none focus:ring-2 focus:ring-stone-300 focus:ring-offset-2 focus:ring-offset-[#FDFCF8] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 active:scale-[0.98] text-stone-500 font-light text-sm"
          >
            Try Demo
          </button>
        </div>

        {/* Footer note */}
        <p className="mt-10 text-center text-[10px] text-stone-400 uppercase tracking-widest leading-relaxed">
          Private &amp; secure
          <br />
          <span className="normal-case tracking-normal font-light italic opacity-70 text-[11px] mt-1 inline-block">
            A companion, not professional care.
          </span>
        </p>
      </div>
    </div>
  );
}
