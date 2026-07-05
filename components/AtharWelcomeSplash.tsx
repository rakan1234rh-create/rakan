import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const ATHAR_LINE_PATHS = [
  'M 545 180 C 580 180, 640 190, 640 230 C 640 270, 590 280, 480 280 L 430 280 L 410 260 L 390 280 L 370 260 L 350 280 L 180 280',
  'M 430 280 L 410 300 L 390 280 L 370 300 L 350 280',
];

const LINE_DURATIONS = [1.8, 0.4];
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
  const path1Ref = useRef<SVGPathElement>(null);
  const path2Ref = useRef<SVGPathElement>(null);
  const [pathLengths, setPathLengths] = useState<[number, number]>([0, 0]);
  const [activePath, setActivePath] = useState<0 | 1 | 2>(0);
  const [lineDone, setLineDone] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const len1 = path1Ref.current?.getTotalLength() || 0;
    const len2 = path2Ref.current?.getTotalLength() || 0;
    if (len1 > 0) setActivePath(1);
    setPathLengths([len1, len2]);
  }, []);

  const handlePath1Complete = useCallback(() => {
    setActivePath(2);
  }, []);

  const handlePath2Complete = useCallback(() => {
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
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black text-white"
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 1.04 : 1 }}
      transition={{ duration: EXIT_DURATION, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={handleShellAnimationComplete}
      aria-label="ATHAR"
      role="img"
    >
      <svg
        viewBox="0 0 800 400"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full max-w-2xl px-6"
      >
        <motion.g
          id="athar-letters"
          fill="currentColor"
          initial={{ opacity: 0 }}
          animate={{ opacity: lineDone ? 1 : 0 }}
          transition={{ duration: TEXT_FADE_DURATION, ease: 'easeOut' }}
        >
          <text
            x="390"
            y="180"
            textAnchor="middle"
            fontFamily="'ZCOOL XiaoWei', 'Petrona', Georgia, serif"
            fontSize="110"
            letterSpacing="12"
          >
            ATHAR
          </text>
        </motion.g>

        <g id="athar-line" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <motion.path
            ref={path1Ref}
            d={ATHAR_LINE_PATHS[0]}
            initial={{ strokeDasharray: pathLengths[0], strokeDashoffset: pathLengths[0] }}
            animate={
              activePath >= 1 && pathLengths[0] > 0
                ? { strokeDashoffset: 0 }
                : undefined
            }
            transition={{
              duration: LINE_DURATIONS[0],
              ease: [0.45, 0, 0.55, 1],
            }}
            onAnimationComplete={() => {
              if (activePath === 1 && pathLengths[0] > 0) handlePath1Complete();
            }}
          />
          <motion.path
            ref={path2Ref}
            d={ATHAR_LINE_PATHS[1]}
            initial={{ strokeDasharray: pathLengths[1], strokeDashoffset: pathLengths[1] }}
            animate={
              activePath >= 2 && pathLengths[1] > 0
                ? { strokeDashoffset: 0 }
                : undefined
            }
            transition={{
              duration: LINE_DURATIONS[1],
              ease: [0.45, 0, 0.55, 1],
            }}
            onAnimationComplete={() => {
              if (activePath === 2 && pathLengths[1] > 0) handlePath2Complete();
            }}
          />
        </g>
      </svg>
    </motion.div>
  );
}

export default AtharWelcomeSplash;
