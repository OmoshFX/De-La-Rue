'use client';

import { useEffect, useState, useRef } from 'react';

const ENCRYPTED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテト0123456789@#$%&*';

function randomChar() {
  return ENCRYPTED_CHARS[Math.floor(Math.random() * ENCRYPTED_CHARS.length)];
}

function generateLine() {
  const len = Math.floor(Math.random() * 30) + 10;
  return Array.from({ length: len }, randomChar).join('');
}

interface SplashScreenProps {
  onComplete: () => void;
}

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [progress, setProgress] = useState(0);
  const [lines, setLines] = useState<string[]>(() => Array.from({ length: 12 }, generateLine));
  const [dots, setDots] = useState([true, true, true, true, false, false, false, false]);
  const [fadeOut, setFadeOut] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Progress counter
  useEffect(() => {
    const start = Date.now();
    const duration = 4000; // 4 seconds to reach 100%

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, Math.floor((elapsed / duration) * 100));
      setProgress(pct);

      if (pct >= 100) {
        clearInterval(intervalRef.current!);
        // Fade out then call onComplete
        setTimeout(() => setFadeOut(true), 300);
        setTimeout(() => onComplete(), 1000);
      }
    }, 30);

    return () => clearInterval(intervalRef.current!);
  }, [onComplete]);

  // Scramble text lines
  useEffect(() => {
    const interval = setInterval(() => {
      setLines(prev => prev.map(() => generateLine()));
    }, 80);
    return () => clearInterval(interval);
  }, []);

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        const next = [...prev];
        const activeCount = Math.floor((progress / 100) * 8);
        return next.map((_, i) => i < activeCount);
      });
    }, 200);
    return () => clearInterval(interval);
  }, [progress]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-700 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: '#020a0a' }}
    >
      {/* Crosshair lines */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-1/2 top-0 bottom-0 w-px" style={{ background: 'rgba(0,255,220,0.06)' }} />
        <div className="absolute top-1/2 left-0 right-0 h-px" style={{ background: 'rgba(0,255,220,0.06)' }} />
      </div>

      {/* Glowing orb */}
      <div className="relative mb-8">
        <div
          className="w-24 h-24 rounded-full"
          style={{
            background: 'radial-gradient(circle at 40% 35%, #00ffe0, #00bcd4 40%, #003344 80%)',
            boxShadow: '0 0 60px 20px rgba(0,220,200,0.35), 0 0 120px 40px rgba(0,180,200,0.15)',
          }}
        />
        {/* Orbiting rings */}
        <div
          className="absolute inset-0 rounded-full border"
          style={{
            borderColor: 'rgba(0,220,200,0.15)',
            transform: 'scale(1.8)',
            animation: 'spin 8s linear infinite',
          }}
        />
        <div
          className="absolute inset-0 rounded-full border"
          style={{
            borderColor: 'rgba(0,220,200,0.1)',
            transform: 'scale(2.4) rotate(45deg)',
            animation: 'spin 12s linear infinite reverse',
          }}
        />
        <div
          className="absolute inset-0 rounded-full border"
          style={{
            borderColor: 'rgba(0,220,200,0.07)',
            transform: 'scale(3) rotate(20deg)',
            animation: 'spin 16s linear infinite',
          }}
        />
      </div>

      {/* Percentage */}
      <div
        className="text-5xl font-mono font-bold mb-1 tabular-nums"
        style={{ color: '#e0fffc', letterSpacing: '0.05em', textShadow: '0 0 20px rgba(0,220,200,0.5)' }}
      >
        {progress}%
      </div>

      {/* Label */}
      <div
        className="text-xs font-mono tracking-[0.4em] mb-8 uppercase"
        style={{ color: 'rgba(0,220,200,0.6)' }}
      >
        System Integrity
      </div>

      {/* Progress bar */}
      <div className="w-64 sm:w-96 h-1 rounded-full mb-8" style={{ background: 'rgba(0,220,200,0.1)' }}>
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #00bcd4, #00ffe0)',
            boxShadow: '0 0 10px rgba(0,220,200,0.6)',
          }}
        />
      </div>

      {/* Encrypted text terminal */}
      <div
        className="w-64 sm:w-[480px] rounded border p-3 font-mono text-[10px] leading-relaxed"
        style={{
          background: 'rgba(0,20,20,0.8)',
          borderColor: 'rgba(0,220,200,0.15)',
          color: 'rgba(0,220,200,0.5)',
          height: '130px',
          overflow: 'hidden',
        }}
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>

      {/* Dot indicators */}
      <div className="flex gap-2 mt-6">
        {dots.map((active, i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full transition-all duration-300"
            style={{
              background: active ? '#00ffe0' : 'rgba(0,220,200,0.2)',
              boxShadow: active ? '0 0 6px rgba(0,220,200,0.8)' : 'none',
            }}
          />
        ))}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg) scale(var(--scale, 1.8)); }
          to { transform: rotate(360deg) scale(var(--scale, 1.8)); }
        }
      `}</style>
    </div>
  );
}
