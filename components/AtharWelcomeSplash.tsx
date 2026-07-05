import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const LETTERS_SPLIT = 0.58;
const LETTERS_DURATION = 2.3;
const LINE_DURATION = 2.9;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

const lettersClip = (rightHidePct: number) =>
  `inset(0 ${rightHidePct}% ${(1 - LETTERS_SPLIT) * 100}% 0)`;

const bottomRtlClip = (leftPct: number) => {
  const y = LETTERS_SPLIT * 100;
  const x = Math.max(0, Math.min(100, leftPct));
  if (x <= 0) return 'inset(0 0 0 0)';
  return `polygon(0% 0%, 100% 0%, 100% ${y}%, 0% ${y}%, ${x}% ${y}%, ${x}% 100%, 100% 100%, 100% ${y}%)`;
};

export type AtharWelcomeSplashProps = {
  onComplete?: () => void;
};

/** شاشة ترحيب — رسم من حرف A ثم الشريط السفلي */
export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [phase, setPhase] = useState<'letters' | 'line' | 'done'>('letters');
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    if (phase !== 'letters') return;
    const t = window.setTimeout(() => setPhase('line'), LETTERS_DURATION * 1000);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'line') return;
    const t = window.setTimeout(() => setPhase('done'), LINE_DURATION * 1000);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'done') return;
    const t = window.setTimeout(() => setExiting(true), HOLD_AFTER_COMPLETE * 1000);
    return () => window.clearTimeout(t);
  }, [phase]);

  const handleShellAnimationComplete = useCallback(() => {
    if (!exiting) return;
    setRemoved(true);
    onComplete?.();
  }, [exiting, onComplete]);

  if (removed) return null;

  const clipPath =
    phase === 'letters'
      ? lettersClip(0)
      : phase === 'line'
        ? 'inset(0 0 0 0)'
        : 'inset(0 0 0 0)';

  return (
    <motion.div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black px-3.5"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.04 : 1 }}
      transition={{ duration: EXIT_DURATION, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={handleShellAnimationComplete}
      aria-label="ATHAR"
      role="img"
    >
      <motion.img
        src={ATHAR_LOGO_SRC}
        alt="ATHAR"
        width={903}
        height={555}
        decoding="async"
        draggable={false}
        className="block h-auto w-full max-w-full object-contain brightness-0 invert drop-shadow-[0_0_28px_rgba(255,255,255,0.14)]"
        initial={{ clipPath: lettersClip(100) }}
        animate={{
          clipPath:
            phase === 'letters'
              ? [lettersClip(100), lettersClip(0)]
              : phase === 'line'
                ? [bottomRtlClip(96), 'inset(0 0 0 0)']
                : 'inset(0 0 0 0)',
        }}
        transition={{
          duration: phase === 'letters' ? LETTERS_DURATION : LINE_DURATION,
          ease: [0.45, 0, 0.55, 1],
        }}
      />
    </motion.div>
  );
}

export default AtharWelcomeSplash;
