import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const SHINE_DURATION = 4.8;
const HOLD_AFTER_SHINE = 0.9;
const EXIT_DURATION = 0.7;

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [active, setActive] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    let holdTimer: number | undefined;
    const startTimer = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setActive(true);
        holdTimer = window.setTimeout(() => setExiting(true), (SHINE_DURATION + HOLD_AFTER_SHINE) * 1000);
      });
    });
    return () => {
      window.cancelAnimationFrame(startTimer);
      if (holdTimer) window.clearTimeout(holdTimer);
    };
  }, []);

  const handleShellAnimationComplete = useCallback(() => {
    if (!exiting) return;
    setRemoved(true);
    onComplete?.();
  }, [exiting, onComplete]);

  if (removed) return null;

  const gleamMask =
    'linear-gradient(105deg, transparent 36%, rgba(255,255,255,0.15) 44%, #fff 50%, rgba(255,255,255,0.15) 56%, transparent 64%)';

  return (
    <motion.div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black px-1"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.04 : 1 }}
      transition={{ duration: EXIT_DURATION, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={handleShellAnimationComplete}
      aria-label="ATHAR"
      role="img"
    >
      <div
        className="relative"
        style={{
          width: 'min(86vw, 42dvh, 22rem)',
          maxWidth: '86vw',
          clipPath: 'inset(34.17% 0 31.09% 0)',
          WebkitClipPath: 'inset(34.17% 0 31.09% 0)',
        }}
      >
        <div className="relative aspect-square w-full drop-shadow-[0_0_36px_rgba(255,255,255,0.2)]">
          <img
            src={ATHAR_LOGO_SRC}
            alt="ATHAR"
            width={1920}
            height={1920}
            decoding="async"
            draggable={false}
            className={`block h-full w-full object-contain brightness-0 invert transition-[opacity,transform] duration-[600ms] ease-out ${
              active ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-0'
            }`}
            style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
          <img
            src={ATHAR_LOGO_SRC}
            alt=""
            aria-hidden
            width={1920}
            height={1920}
            decoding="async"
            draggable={false}
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain brightness-0 invert ${
              active ? 'aws-brand-gleam-active' : 'opacity-0'
            }`}
            style={{
              filter: 'brightness(0) invert(1) brightness(2.4) drop-shadow(0 0 18px rgba(255,255,255,0.95))',
              WebkitMaskImage: gleamMask,
              maskImage: gleamMask,
              WebkitMaskSize: '280% 100%',
              maskSize: '280% 100%',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: '150% center',
              maskPosition: '150% center',
            }}
          />
        </div>
      </div>
      <style>{`
        .aws-brand-gleam-active {
          opacity: 1;
          transition: opacity 0.35s ease-out;
          animation: awsLogoGleam 2.3s cubic-bezier(0.45, 0, 0.25, 1) 0.45s 2;
        }
        @keyframes awsLogoGleam {
          0% { -webkit-mask-position: 150% center; mask-position: 150% center; }
          100% { -webkit-mask-position: -50% center; mask-position: -50% center; }
        }
      `}</style>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
