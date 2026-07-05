import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LINE_PATH =
  'M 380 100 C 420 100, 420 150, 380 150 L 280 150 L 260 130 L 240 150 L 260 170 L 280 150 M 240 150 L 220 130 L 200 150 L 220 170 L 240 150 L 50 150';

const LINE_DURATION = 2.2;
const TEXT_FADE_DURATION = 0.8;
const HOLD_AFTER_COMPLETE = 1;
const EXIT_DURATION = 0.7;

export type AtharWelcomeSplashProps = {
  /** يُستدعى بعد اختفاء الشاشة بالكامل */
  onComplete?: () => void;
};

/**
 * شاشة ترحيب — رسم الخط من اليمين لليسار ثم ظهور النص ثم إزالة الشاشة.
 * يتطلب: react, framer-motion, tailwindcss
 */
export function AtharWelcomeSplash({ onComplete }: AtharWelcomeSplashProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const [lineDone, setLineDone] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    setPathLength(path.getTotalLength());
  }, []);

  const handleLineComplete = useCallback(() => {
    setLineDone(true);
  }, []);

  useEffect(() => {
    if (!lineDone) return;
    const timer = window.setTimeout(
      () => setExiting(true),
      (TEXT_FADE_DURATION + HOLD_AFTER_COMPLETE) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [lineDone]);

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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 500 200"
        className="h-auto w-full max-w-md px-6"
      >
        <motion.g
          id="athar-text"
          fill="white"
          initial={{ opacity: 0 }}
          animate={{ opacity: lineDone ? 1 : 0 }}
          transition={{ duration: TEXT_FADE_DURATION, ease: 'easeOut' }}
        >
          <text
            x="250"
            y="100"
            textAnchor="middle"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontSize="64"
            letterSpacing="8"
          >
            ATHAR
          </text>
        </motion.g>

        <g id="athar-line">
          <motion.path
            ref={pathRef}
            d={ATHAR_LINE_PATH}
            fill="none"
            stroke="white"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={{ strokeDasharray: pathLength, strokeDashoffset: pathLength }}
            animate={pathLength > 0 ? { strokeDashoffset: 0 } : undefined}
            transition={{
              duration: LINE_DURATION,
              ease: [0.45, 0, 0.55, 1],
            }}
            onAnimationComplete={() => {
              if (pathLength > 0) handleLineComplete();
            }}
          />
        </g>
      </svg>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
