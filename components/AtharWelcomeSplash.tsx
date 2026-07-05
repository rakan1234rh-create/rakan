import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const LETTERS_SPLIT = 0.526;
const LINE_TOP = 0.586;
const LETTERS_DURATION = 2.4;
const LINE_DURATION = 3.2;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const lettersClip = (rightHidePct: number) =>
  `inset(0 ${rightHidePct}% ${(1 - LETTERS_SPLIT) * 100}% 0)`;

const lettersLockedClip = () => {
  const y = (LETTERS_SPLIT * 100).toFixed(2);
  return `polygon(0% 0%, 100% 0%, 100% ${y}%, 0% ${y}%)`;
};

const lineClip = (leftHidePct: number) => {
  const top = (LINE_TOP * 100).toFixed(2);
  const left = Math.max(0, Math.min(100, leftHidePct));
  return `inset(${top}% 0 0 ${left}%)`;
};

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [lettersClipPath, setLettersClipPath] = useState(lettersClip(100));
  const [lineClipPath, setLineClipPath] = useState(lineClip(100));
  const [lineVisible, setLineVisible] = useState(false);
  const [merged, setMerged] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const lettersMs = LETTERS_DURATION * 1000;
    const lineMs = LINE_DURATION * 1000;
    const start = performance.now();
    let phase: 'letters' | 'line' | 'done' = 'letters';

    const tick = (now: number) => {
      const elapsed = now - start;

      if (phase === 'letters') {
        const raw = Math.min(1, elapsed / lettersMs);
        const t = ease(raw);
        setLettersClipPath(lettersClip(100 * (1 - t)));
        if (raw >= 1) {
          setLettersClipPath(lettersLockedClip());
          setLineVisible(true);
          phase = 'line';
        }
      } else if (phase === 'line') {
        const lineElapsed = elapsed - lettersMs;
        const raw = Math.min(1, lineElapsed / lineMs);
        const t = ease(raw);
        setLineClipPath(lineClip(100 * (1 - t)));
        if (raw >= 1) {
          setMerged(true);
          setLineVisible(false);
          phase = 'done';
          window.setTimeout(() => setExiting(true), HOLD_AFTER_COMPLETE * 1000);
          return;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
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
