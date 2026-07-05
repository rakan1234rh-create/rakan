import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const LETTERS_SPLIT = 0.54;
const LETTERS_DURATION = 2.4;
const LINE_DURATION = 3.2;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const lettersClip = (rightHidePct: number) =>
  `inset(0 ${rightHidePct}% ${(1 - LETTERS_SPLIT) * 100}% 0)`;

const combinedClip = (bottomLeftPct: number) => {
  const y = (LETTERS_SPLIT * 100).toFixed(2);
  const x = Math.max(0, Math.min(100, bottomLeftPct));
  if (x <= 0) return 'inset(0 0 0 0)';
  if (x >= 99.999) return `polygon(0% 0%, 100% 0%, 100% ${y}%, 0% ${y}%)`;
  return `polygon(0% 0%, 100% 0%, 100% ${y}%, ${x}% ${y}%, ${x}% 100%, 100% 100%)`;
};

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [clipPath, setClipPath] = useState(lettersClip(100));
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const totalMs = (LETTERS_DURATION + LINE_DURATION) * 1000;
    const lettersPortion = LETTERS_DURATION / (LETTERS_DURATION + LINE_DURATION);
    const start = performance.now();

    const tick = (now: number) => {
      const raw = Math.min(1, (now - start) / totalMs);
      if (raw <= lettersPortion) {
        const t = ease(raw / lettersPortion);
        setClipPath(lettersClip(100 * (1 - t)));
      } else {
        const t = ease((raw - lettersPortion) / (1 - lettersPortion));
        setClipPath(combinedClip(100 * (1 - t)));
      }

      if (raw < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setClipPath('inset(0 0 0 0)');
        window.setTimeout(() => setExiting(true), HOLD_AFTER_COMPLETE * 1000);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black px-1.5"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.04 : 1 }}
      transition={{ duration: EXIT_DURATION, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={handleShellAnimationComplete}
      aria-label="ATHAR"
      role="img"
    >
      <div className="flex w-[calc(100vw-12px)] max-w-[calc(100vw-12px)] items-center justify-center">
        <motion.img
          src={ATHAR_LOGO_SRC}
          alt="ATHAR"
          width={903}
          height={555}
          decoding="async"
          draggable={false}
          style={{ clipPath, WebkitClipPath: clipPath }}
          className="block h-auto w-full max-w-full origin-center scale-[1.85] object-contain brightness-0 invert drop-shadow-[0_0_28px_rgba(255,255,255,0.14)] md:scale-125"
        />
      </div>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
