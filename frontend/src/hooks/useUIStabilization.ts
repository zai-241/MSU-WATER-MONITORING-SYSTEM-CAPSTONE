import { useState, useEffect, useRef } from 'react';
import { Tank } from '@/store/useStore';

/**
 * Custom hook to smoothly interpolate a numeric value towards a target.
 * Employs requestAnimationFrame to loop, adjusting the value exponentially.
 * Automatically sleeps when the value stabilizes within a small margin to conserve CPU.
 * 
 * @param targetValue The value to interpolate towards
 * @param speed Interpolation coefficient (0.01 to 1.0). Higher is faster.
 */
export function useSmoothedValue(targetValue: number, speed = 0.06): number {
  const [currentValue, setCurrentValue] = useState(targetValue);
  const requestRef = useRef<number | null>(null);
  const currentValRef = useRef(currentValue);

  // Synchronize ref with state to avoid enclosing stale values in the animate callback
  useEffect(() => {
    currentValRef.current = currentValue;
  }, [currentValue]);

  useEffect(() => {
    const tick = () => {
      const diff = targetValue - currentValRef.current;
      // If we are extremely close to the target, snap directly to it and stop loop
      if (Math.abs(diff) < 0.005) {
        setCurrentValue(targetValue);
        requestRef.current = null;
      } else {
        // Adjust current value closer to target by a fraction of the distance
        setCurrentValue((prev) => prev + diff * speed);
        requestRef.current = requestAnimationFrame(tick);
      }
    };

    // If the animation frame loop isn't running, start it
    if (requestRef.current === null) {
      requestRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    };
  }, [targetValue, speed]);

  return currentValue;
}

/**
 * Custom hook to throttle high-frequency state updates.
 * Updates the returned value at most once per limit (ms).
 * 
 * @param value The value to throttle
 * @param limit Time window in milliseconds
 */
export function useThrottledValue<T>(value: T, limit: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastRan = useRef(Date.now());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeRemaining = limit - (now - lastRan.current);

    if (timeRemaining <= 0) {
      // If the limit interval has already elapsed, update state immediately
      setThrottledValue(value);
      lastRan.current = now;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    } else {
      // If within limit window, set a deferred timeout to update later
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setThrottledValue(value);
        lastRan.current = Date.now();
      }, timeRemaining);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, limit]);

  return throttledValue;
}

/**
 * Processes raw Firebase Tank values, applying state buffering, delayed stabilization,
 * and user-readability rounding to solve rapid sensor flickering issues.
 * 
 * @param tank Raw Tank data from the database
 */
export function useProcessedTankData(tank: Tank) {
  const safeLevel = typeof tank?.waterLevel === 'number' && !isNaN(tank.waterLevel) ? tank.waterLevel : 0;
  const safePh = typeof tank?.phLevel === 'number' && !isNaN(tank.phLevel) ? tank.phLevel : 7.0;
  const safeHeight = typeof tank?.waterHeight === 'number' && !isNaN(tank.waterHeight) ? tank.waterHeight : 0;

  // 1. Maintain internal state for raw telemetry values (updated instantly by Firebase)
  const [rawLevel, setRawLevel] = useState(safeLevel);
  const [rawPh, setRawPh] = useState(safePh);
  const [rawHeight, setRawHeight] = useState(safeHeight);
  
  // 2. Maintain internal state for stabilized displayed values (initialize with rounded targets)
  const initialRoundedLevel = Math.round(safeLevel / 5) * 5;
  const [displayedLevel, setDisplayedLevel] = useState(initialRoundedLevel);
  
  const initialRoundedPh = Math.round(safePh * 10) / 10;
  const [displayedPh, setDisplayedPh] = useState(initialRoundedPh);
  
  const [displayedHeight, setDisplayedHeight] = useState(safeHeight);

  // Timer references to debounce micro-fluctuations
  const levelTimerRef = useRef<NodeJS.Timeout | null>(null);
  const phTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync raw telemetry changes instantly from Firebase props
  useEffect(() => {
    const nextLevel = typeof tank?.waterLevel === 'number' && !isNaN(tank.waterLevel) ? tank.waterLevel : 0;
    const nextPh = typeof tank?.phLevel === 'number' && !isNaN(tank.phLevel) ? tank.phLevel : 7.0;
    const nextHeight = typeof tank?.waterHeight === 'number' && !isNaN(tank.waterHeight) ? tank.waterHeight : 0;
    setRawLevel(nextLevel);
    setRawPh(nextPh);
    setRawHeight(nextHeight);
  }, [tank?.waterLevel, tank?.phLevel, tank?.waterHeight]);

  // WATER LEVEL STABILIZATION:
  // Rounds displayed percentages to clean values (91->90, 94->95) using Math.round(level / 5) * 5.
  // Instantly updates displayed value if change >= 5% to preserve responsiveness to real emptying/filling.
  // Throttles and debounces tiny fluctuations between 90-92% using a 1000ms delayed stabilization timer.
  useEffect(() => {
    const targetLevel = Math.round(rawLevel / 5) * 5;
    const diff = Math.abs(targetLevel - displayedLevel);

    if (levelTimerRef.current) {
      clearTimeout(levelTimerRef.current);
      levelTimerRef.current = null;
    }

    if (diff >= 5) {
      // Significant shift: update display instantly for operational safety
      setDisplayedLevel(targetLevel);
      setDisplayedHeight(rawHeight);
    } else if (diff > 0) {
      // Minor fluctuation: hold displayed value and only update if it remains stable for 1.2 seconds
      levelTimerRef.current = setTimeout(() => {
        setDisplayedLevel(targetLevel);
        setDisplayedHeight(rawHeight);
      }, 1200);
    }

    return () => {
      if (levelTimerRef.current) {
        clearTimeout(levelTimerRef.current);
      }
    };
  }, [rawLevel, rawHeight, displayedLevel]);

  // PH LEVEL STABILIZATION:
  // Standardizes pH to 1 decimal place.
  // Ignores minor chemical drifts (threshold < 0.2 pH units) unless they persist for 1.2 seconds.
  useEffect(() => {
    const targetPh = Math.round(rawPh * 10) / 10;
    const diff = Math.abs(targetPh - displayedPh);

    if (phTimerRef.current) {
      clearTimeout(phTimerRef.current);
      phTimerRef.current = null;
    }

    if (diff >= 0.2) {
      // Meaningful shift: update immediately
      setDisplayedPh(targetPh);
    } else if (diff > 0) {
      // Minor drift: delay rendering to filter out sensor noise
      phTimerRef.current = setTimeout(() => {
        setDisplayedPh(targetPh);
      }, 1200);
    }

    return () => {
      if (phTimerRef.current) {
        clearTimeout(phTimerRef.current);
      }
    };
  }, [rawPh, displayedPh]);

  const safeFinalHeight = typeof displayedHeight === 'number' && !isNaN(displayedHeight) ? displayedHeight : 0;
  const safeFinalPh = typeof displayedPh === 'number' && !isNaN(displayedPh) ? displayedPh : 7.0;
  const safeFinalLevel = typeof displayedLevel === 'number' && !isNaN(displayedLevel) ? displayedLevel : 0;

  return {
    ...tank,
    phLevel: safeFinalPh,
    waterLevel: safeFinalLevel,
    waterHeight: Number(safeFinalHeight.toFixed(2)),
  };
}
