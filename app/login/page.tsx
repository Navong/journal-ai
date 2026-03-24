'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);
  const [error, setError] = useState('');
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [fadeIn, setFadeIn] = useState(false);
  const isDevelopment = process.env.NODE_ENV === 'development';

  useEffect(() => {
    setTimeout(() => setFadeIn(true), 80);
  }, []);

  const isLoading = googleLoading || demoLoading || devLoading;

  const handleTryDemo = () => {
    setDemoLoading(true);
    const expires = new Date();
    expires.setTime(expires.getTime() + 24 * 60 * 60 * 1000);
    document.cookie = `demo-mode=true; expires=${expires.toUTCString()}; path=/`;
    router.push('/');
    router.refresh();
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      await signIn('google', { callbackUrl: '/' });
    } catch (err) {
      setError('An error occurred. Please try again.');
      setGoogleLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setError('');
    setDevLoading(true);
    try {
      const result = await signIn('DevLogin', { redirect: false });
      if (result?.error) {
        setError(`Dev login failed: ${result.error}`);
        setDevLoading(false);
      } else if (result?.ok !== false) {
        router.push('/');
        router.refresh();
      } else {
        setDevLoading(false);
      }
    } catch (err) {
      setError(`An error occurred: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setDevLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FDFCF8',
      display: 'flex',
      fontFamily: "Georgia, 'Times New Roman', serif",
      color: '#3A3530',
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slowDrift {
          0%   { transform: translateY(0px) rotate(0deg); }
          50%  { transform: translateY(-18px) rotate(1.5deg); }
          100% { transform: translateY(0px) rotate(0deg); }
        }
        @keyframes slowDrift2 {
          0%   { transform: translateY(0px) rotate(0deg); }
          50%  { transform: translateY(14px) rotate(-1deg); }
          100% { transform: translateY(0px) rotate(0deg); }
        }
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
          40%           { opacity: 1;    transform: scale(1); }
        }
        @media (max-width: 680px) {
          .login-left-panel { display: none !important; }
        }
      `}</style>

      {/* ── Left panel — decorative ── */}
      <div
        className="login-left-panel"
        style={{
          width: '45%',
          position: 'relative',
          background: '#F0EDE6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Grain texture overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
          opacity: 0.6, pointerEvents: 'none',
        }} />

        {/* Floating shapes */}
        <div style={{
          position: 'absolute', top: '12%', left: '18%',
          width: 180, height: 180,
          borderRadius: '60% 40% 70% 30% / 50% 60% 40% 50%',
          background: 'linear-gradient(135deg, #D4CDB8 0%, #C8C0A8 100%)',
          opacity: 0.45,
          animation: 'slowDrift 9s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '18%', right: '14%',
          width: 130, height: 130,
          borderRadius: '40% 60% 30% 70% / 60% 40% 70% 30%',
          background: 'linear-gradient(135deg, #C4BBA4 0%, #B8AF98 100%)',
          opacity: 0.35,
          animation: 'slowDrift2 12s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', top: '52%', left: '8%',
          width: 80, height: 80,
          borderRadius: '50%',
          background: '#D8D2C0',
          opacity: 0.25,
          animation: 'slowDrift 15s ease-in-out infinite reverse',
        }} />

        {/* Thin vertical rule */}
        <div style={{
          position: 'absolute', top: '20%', right: 0,
          width: 1, height: '60%',
          background: 'linear-gradient(to bottom, transparent, #C4BAB0 40%, #C4BAB0 60%, transparent)',
          opacity: 0.4,
        }} />

        {/* Centre quote */}
        <div style={{
          position: 'relative', zIndex: 2,
          textAlign: 'center', padding: '0 48px',
          opacity: fadeIn ? 1 : 0,
          transform: fadeIn ? 'none' : 'translateY(20px)',
          transition: 'opacity 0.9s ease 0.2s, transform 0.9s ease 0.2s',
        }}>
          <div style={{
            fontSize: 64, lineHeight: 1, color: '#B5A47A',
            marginBottom: 8, fontFamily: 'Georgia, serif', opacity: 0.5,
          }}>"</div>
          <p style={{
            fontSize: 22, lineHeight: 1.65, fontWeight: 400,
            color: '#5C5044', letterSpacing: '-0.01em',
            margin: '0 0 24px',
          }}>
            The act of writing<br />
            is the act of<br />
            discovering what<br />
            you believe.
          </p>
          <p style={{
            fontSize: 11, letterSpacing: '0.14em',
            textTransform: 'uppercase',
            fontFamily: "'Helvetica Neue', sans-serif",
            color: '#A89E92',
          }}>
            — David Hare
          </p>
          <div style={{
            width: 40, height: 1,
            background: '#B5A47A',
            margin: '32px auto 0',
            opacity: 0.6,
          }} />
        </div>

        {/* Bottom label */}
        <div style={{
          position: 'absolute', bottom: 28, left: 0, right: 0,
          textAlign: 'center',
          fontSize: 10, letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontFamily: "'Helvetica Neue', sans-serif",
          color: '#B5A99A', opacity: 0.7,
        }}>
          Est. 2025
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 40px',
        opacity: fadeIn ? 1 : 0,
        transform: fadeIn ? 'none' : 'translateY(24px)',
        transition: 'opacity 0.7s ease 0.1s, transform 0.7s ease 0.1s',
      }}>
        <div style={{ width: '100%', maxWidth: 380 }}>

          {/* Logo */}
          <div style={{ marginBottom: 52, textAlign: 'left' }}>
            <h1 style={{
              fontSize: 30, fontWeight: 400,
              letterSpacing: '-0.025em', color: '#2C2825',
              margin: 0, lineHeight: 1,
            }}>
              Serenity
            </h1>
            <p style={{
              fontSize: 11, letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: "'Helvetica Neue', sans-serif",
              color: '#B5A99A', marginTop: 7, margin: '7px 0 0',
            }}>
              Journal
            </p>
          </div>

          {/* Heading */}
          <div style={{ marginBottom: 36 }}>
            <h2 style={{
              fontSize: 22, fontWeight: 400,
              color: '#3A3530', margin: '0 0 8px',
              letterSpacing: '-0.01em',
            }}>
              Welcome back
            </h2>
            <p style={{
              fontSize: 13, color: '#A89E92',
              fontFamily: "'Helvetica Neue', sans-serif",
              margin: 0, lineHeight: 1.5,
            }}>
              Sign in to continue your journey.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              marginBottom: 20, padding: '12px 16px',
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 4, color: '#991B1B',
              fontSize: 13, fontFamily: "'Helvetica Neue', sans-serif",
              lineHeight: 1.5,
            }}>
              {error}
            </div>
          )}

          {/* Google button */}
          <button
            onMouseEnter={() => setHoveredBtn('google')}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            style={{
              width: '100%', padding: '14px 20px',
              border: `1.5px solid ${hoveredBtn === 'google' ? '#B5A47A' : '#E0D8CE'}`,
              borderRadius: 4,
              background: hoveredBtn === 'google' ? '#FAF8F4' : '#FDFCF8',
              color: '#3A3530',
              fontSize: 13, letterSpacing: '0.04em',
              fontFamily: "'Helvetica Neue', sans-serif",
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              transition: 'all 0.2s',
              opacity: (demoLoading || devLoading) ? 0.5 : 1,
              boxSizing: 'border-box',
            }}
          >
            {googleLoading ? (
              <LoadingDots />
            ) : (
              <>
                <GoogleIcon />
                Continue with Google
              </>
            )}
          </button>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 16, margin: '28px 0',
          }}>
            <div style={{ flex: 1, height: 1, background: '#E8E4DD' }} />
            <span style={{
              fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontFamily: "'Helvetica Neue', sans-serif",
              color: '#C4BAB0',
            }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#E8E4DD' }} />
          </div>

          {/* Demo button */}
          <button
            onMouseEnter={() => setHoveredBtn('demo')}
            onMouseLeave={() => setHoveredBtn(null)}
            onClick={handleTryDemo}
            disabled={isLoading}
            style={{
              width: '100%', padding: '14px 20px',
              border: '1.5px solid #E0D8CE',
              borderRadius: 4,
              background: hoveredBtn === 'demo' ? '#F4F1EB' : 'transparent',
              color: '#7A6E60',
              fontSize: 13, letterSpacing: '0.04em',
              fontFamily: "'Helvetica Neue', sans-serif",
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.2s',
              opacity: (googleLoading || devLoading) ? 0.5 : 1,
              boxSizing: 'border-box',
            }}
          >
            {demoLoading ? (
              <LoadingDots color="#B5A47A" />
            ) : (
              <>
                <span style={{ fontSize: 15 }}>✦</span>
                Try Demo — No sign-in required
              </>
            )}
          </button>

          {/* Dev Login (development only) */}
          {isDevelopment && (
            <button
              onMouseEnter={() => setHoveredBtn('dev')}
              onMouseLeave={() => setHoveredBtn(null)}
              onClick={handleDevLogin}
              disabled={isLoading}
              style={{
                width: '100%', padding: '12px 20px',
                marginTop: 12,
                border: '1.5px solid #E8D5A0',
                borderRadius: 4,
                background: hoveredBtn === 'dev' ? '#FFFBF0' : 'transparent',
                color: '#92710A',
                fontSize: 12, letterSpacing: '0.06em',
                fontFamily: "'Helvetica Neue', sans-serif",
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
                opacity: (googleLoading || demoLoading) ? 0.5 : 1,
                boxSizing: 'border-box',
              }}
            >
              {devLoading ? <LoadingDots color="#C4956A" /> : 'Dev Login'}
            </button>
          )}

          {/* Privacy note */}
          <div style={{
            marginTop: 36,
            padding: '16px 20px',
            background: '#F4F1EB',
            borderRadius: 4,
            borderLeft: '2px solid #D4CDB8',
          }}>
            <p style={{
              fontSize: 12, color: '#8A7E72',
              fontFamily: "'Helvetica Neue', sans-serif",
              margin: 0, lineHeight: 1.65,
            }}>
              Your entries are private and encrypted.<br />
              <span style={{ color: '#B5A99A' }}>
                A reflective companion — not professional care.
              </span>
            </p>
          </div>

          {/* Footer links */}
          <div style={{
            marginTop: 32,
            display: 'flex', gap: 20, justifyContent: 'center',
          }}>
            {['Privacy', 'Terms', 'Support'].map(link => (
              <button
                key={link}
                onMouseEnter={e => (e.currentTarget.style.color = '#8A7E72')}
                onMouseLeave={e => (e.currentTarget.style.color = '#C4BAB0')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: "'Helvetica Neue', sans-serif",
                  color: '#C4BAB0',
                  padding: 0,
                  transition: 'color 0.2s',
                }}
              >
                {link}
              </button>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

function LoadingDots({ color = '#A89E92' }: { color?: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: color, display: 'inline-block',
          animation: `dotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </span>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
