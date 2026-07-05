import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LOGO_SRC = 'icons/athar-logo-v401.png';
const REVEAL_DURATION = 5.2;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

export type AtharWelcomeSplashProps = {
  /** يُستدعى بعد اختفاء الشاشة بالكامل */
  onComplete?: () => void;
};

/**
 * شاشة ترحيب — نفس شعار الشريط العلوي (athar-logo-v401.png)
 * مع كشف تدريجي من اليمين لليسار.
 */
export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const [revealed, setRevealed] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(
      () => setExiting(true),
      (REVEAL_DURATION + HOLD_AFTER_COMPLETE) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [revealed]);

  const handleShellAnimationComplete = useCallback(() => {
    if (!exiting) return;
    setRemoved(true);
    onComplete?.();
  }, [exiting, onComplete]);

  if (removed) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black"
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
        className="block h-auto w-full max-w-3xl object-contain brightness-0 invert drop-shadow-[0_0_28px_rgba(255,255,255,0.14)]"
        initial={{ clipPath: 'inset(0 0 0 100%)' }}
        animate={{ clipPath: revealed ? 'inset(0 0 0 0)' : 'inset(0 0 0 100%)' }}
        transition={{ duration: REVEAL_DURATION, ease: [0.45, 0, 0.55, 1] }}
      />
    </motion.div>
  );
}

export default AtharWelcomeSplash;
