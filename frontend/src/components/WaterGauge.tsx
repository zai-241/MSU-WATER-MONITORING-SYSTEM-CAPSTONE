import { Droplet } from 'lucide-react';
import { useSmoothedValue } from '@/hooks/useUIStabilization';

interface WaterGaugeProps {
  percentage: number;
  status: 'safe' | 'warning' | 'danger';
  size?: number;
  isPlanned?: boolean;
}

const WaterGauge = ({ percentage, status, size = 140, isPlanned = false }: WaterGaugeProps) => {
  // Apply visual smoothing (interpolation) to percentage values
  // This ensures the water level gauge transition runs smoothly without visual jitter
  const smoothedPercent = useSmoothedValue(isPlanned ? 0 : percentage, 0.08);
  const displayPercent = Math.round(smoothedPercent);

  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  
  // Calculate SVG stroke offset using the smoothed percentage for fluid gauge animations
  // When planned, offset equals circumference (empty fill)
  const offset = isPlanned ? circumference : circumference - (smoothedPercent / 100) * circumference;

  const colorClass = isPlanned ? 'text-muted-foreground' : status === 'warning' ? 'text-warning' : status === 'danger' ? 'text-danger' : 'text-safe';
  const strokeColor = isPlanned ? 'hsl(var(--muted))' : status === 'warning' ? 'hsl(25, 95%, 53%)' : status === 'danger' ? 'hsl(0, 84%, 60%)' : 'hsl(142, 71%, 45%)';

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(0, 0%, 90%)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={strokeColor} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          className={isPlanned ? '' : 'transition-all duration-700'}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <Droplet className={`h-5 w-5 ${colorClass}`} />
        <span className="text-xl font-bold mt-1 text-foreground">
          {isPlanned ? '--' : `${displayPercent}%`}
        </span>
      </div>
    </div>
  );
};

export default WaterGauge;
