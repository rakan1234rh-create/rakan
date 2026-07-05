import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const REVEAL_DURATION = 5.2;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [revealed, setRevealed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    let holdTimer: number | undefined;
    const startTimer = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setRevealed(true);
        holdTimer = window.setTimeout(() => setExiting(true), (REVEAL_DURATION + HOLD_AFTER_COMPLETE) * 1000);
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

  const logoClass = 'block h-full w-full max-w-full object-contain brightness-0 invert';

  return (
    <motion.div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black px-1.5"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.04 : 1 }}
      transition={{ duration: EXIT_DURATION, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={handleShellAnimationComplete}
      aria-label="ATHAR"
      role="img"
    >
      <div className="relative flex w-[calc(100vw-12px)] max-w-[calc(100vw-12px)] items-center justify-center drop-shadow-[0_0_28px_rgba(255,255,255,0.14)] md:w-[min(94vw,52rem)] md:max-w-[min(94vw,52rem)]">
        <div
          className="relative aspect-square w-full origin-center scale-[1.85] md:scale-125"
          style={{ clipPath: 'inset(34.17% 0 31.09% 0)', WebkitClipPath: 'inset(34.17% 0 31.09% 0)' }}
        >
          <img
            src={ATHAR_LOGO_SRC}
            alt="ATHAR"
            width={1920}
            height={1920}
            decoding="async"
            draggable={false}
            className={logoClass}
            style={{
              clipPath: revealed ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)',
              WebkitClipPath: revealed ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)',
              transition: revealed
                ? `clip-path ${REVEAL_DURATION}s cubic-bezier(0.45, 0, 0.55, 1), -webkit-clip-path ${REVEAL_DURATION}s cubic-bezier(0.45, 0, 0.55, 1)`
                : undefined,
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
