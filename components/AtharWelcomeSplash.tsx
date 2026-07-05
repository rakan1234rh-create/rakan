import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const LETTERS_SPLIT = 0.526;
const LINE_TOP = 0.576;
const TOTAL_DURATION = 5.2;
const LINE_START_AT = 0.28;
const LETTERS_DONE_AT = 0.42;
const LINE_DONE_AT = 0.74;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);

const lettersClip = (rightHidePct: number) =>
  `inset(0 ${rightHidePct}% ${(1 - LETTERS_SPLIT) * 100}% 0)`;

const lettersLockedClip = () => {
  const y = (LETTERS_SPLIT * 100).toFixed(2);
  return `polygon(0% 0%, 100% 0%, 100% ${y}%, 0% ${y}%)`;
};

const lineReveal = (progress: number) => {
  const top = (LINE_TOP * 100).toFixed(2);
  const p = Math.max(0, Math.min(1, progress));
  const right = ((1 - p) * 100).toFixed(2);
  return `inset(${top}% ${right}% 0 0)`;
};

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [lettersClipPath, setLettersClipPath] = useState(lettersClip(100));
  const [lineClipPath, setLineClipPath] = useState(lineReveal(0));
  const [lineVisible, setLineVisible] = useState(true);
  const [merged, setMerged] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const totalMs = TOTAL_DURATION * 1000;
    const start = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / totalMs);

      const letterP = Math.min(1, p / LETTERS_DONE_AT);
      if (p < LETTERS_DONE_AT) {
        setLettersClipPath(lettersClip(100 * (1 - easeOut(letterP))));
      } else {
        setLettersClipPath(lettersLockedClip());
      }

      if (p >= LINE_START_AT) {
        const lineSpan = LINE_DONE_AT - LINE_START_AT;
        const lineP = Math.min(1, (p - LINE_START_AT) / lineSpan);
        setLineClipPath(lineReveal(lineP));
      } else {
        setLineClipPath(lineReveal(0));
      }

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setLineClipPath(lineReveal(1));
        setMerged(true);
        setLineVisible(false);
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

  const logoClass = 'block h-auto w-full max-w-full object-contain brightness-0 invert';

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
      <div className="relative flex w-[calc(100vw-12px)] max-w-[calc(100vw-12px)] items-center justify-center drop-shadow-[0_0_28px_rgba(255,255,255,0.14)]">
        <div
          className="relative w-full origin-center scale-[1.85] md:scale-125"
          style={{ clipPath: 'inset(34.17% 0 31.09% 0)', WebkitClipPath: 'inset(34.17% 0 31.09% 0)' }}
        >
          <img
            src={ATHAR_LOGO_SRC}
            alt="ATHAR"
            width={1920}
            height={1920}
            decoding="async"
            draggable={false}
            style={
              merged
                ? undefined
                : { clipPath: lettersClipPath, WebkitClipPath: lettersClipPath }
            }
            className={`relative z-[1] ${logoClass}`}
          />
          {!merged && lineVisible && (
            <img
              src={ATHAR_LOGO_SRC}
              alt=""
              aria-hidden
              width={1920}
              height={1920}
              decoding="async"
              draggable={false}
              style={{ clipPath: lineClipPath, WebkitClipPath: lineClipPath }}
              className={`absolute inset-0 z-[2] ${logoClass}`}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
