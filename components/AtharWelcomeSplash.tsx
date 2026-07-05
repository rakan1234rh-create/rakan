import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const TOTAL_DURATION = 4.8;
const LINE_START_AT = 0.2;
const LETTERS_DONE_AT = 0.36;
const LINE_DONE_AT = 0.68;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [lettersScale, setLettersScale] = useState(0);
  const [lineScale, setLineScale] = useState(0);
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
      setLettersScale(p < LETTERS_DONE_AT ? easeOut(letterP) : 1);

      if (p >= LINE_START_AT) {
        const lineSpan = LINE_DONE_AT - LINE_START_AT;
        const lineP = Math.min(1, (p - LINE_START_AT) / lineSpan);
        setLineScale(lineP);
      } else {
        setLineScale(0);
      }

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setLineScale(1);
        setMerged(true);
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

  const logoClass = 'block brightness-0 invert';

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
          className="relative aspect-square w-full origin-center scale-[1.85] md:scale-125"
          style={{ clipPath: 'inset(34.17% 0 31.09% 0)', WebkitClipPath: 'inset(34.17% 0 31.09% 0)' }}
        >
          <div
            className={
              merged
                ? 'relative w-full overflow-visible'
                : 'absolute left-0 top-0 z-[1] h-[52.6%] w-full overflow-hidden'
            }
          >
            <div
              className="h-full w-full"
              style={{
                transform: merged ? undefined : `scaleX(${lettersScale})`,
                transformOrigin: 'left center',
                willChange: merged ? undefined : 'transform',
              }}
            >
              <img
                src={ATHAR_LOGO_SRC}
                alt="ATHAR"
                width={1920}
                height={1920}
                decoding="async"
                draggable={false}
                className={`${logoClass} ${merged ? 'h-auto w-full max-w-full object-contain' : 'h-[calc(100%/0.526)] w-full max-w-none object-cover object-top'}`}
              />
            </div>
          </div>
          {!merged && (
            <div className="absolute left-0 top-[57.6%] z-[2] h-[10%] w-full overflow-hidden">
              <div
                className="h-full w-full"
                style={{
                  transform: `scaleX(${lineScale})`,
                  transformOrigin: 'right center',
                  willChange: 'transform',
                }}
              >
                <img
                  src={ATHAR_LOGO_SRC}
                  alt=""
                  aria-hidden
                  width={1920}
                  height={1920}
                  decoding="async"
                  draggable={false}
                  className={`${logoClass} absolute left-0 top-[-576%] h-[1000%] w-full max-w-none object-cover object-top`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
