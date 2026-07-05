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
        className="relative origin-center scale-[2.15] drop-shadow-[0_0_36px_rgba(255,255,255,0.2)] md:scale-[1.45]"
        style={{
          width: 'calc(100vw - 8px)',
          maxWidth: 'calc(100vw - 8px)',
          clipPath: 'inset(34.17% 0 31.09% 0)',
          WebkitClipPath: 'inset(34.17% 0 31.09% 0)',
        }}
      >
        <div className="relative aspect-square w-full overflow-hidden">
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
          {active && (
            <span
              aria-hidden
              className="pointer-events-none absolute -left-[70%] top-[-35%] h-[170%] w-[52%] opacity-100 mix-blend-screen"
              style={{
                background:
                  'linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 38%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0.05) 62%, rgba(255,255,255,0) 100%)',
                animation: 'awsLogoShine 2.1s cubic-bezier(0.45, 0, 0.25, 1) 0.45s 2',
                transform: 'skewX(-22deg) translateX(-200%)',
              }}
            />
          )}
        </div>
      </div>
      <style>{`
        @keyframes awsLogoShine {
          0% { transform: skewX(-22deg) translateX(-200%); }
          100% { transform: skewX(-22deg) translateX(460%); }
        }
      `}</style>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
