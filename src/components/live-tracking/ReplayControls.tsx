// src/components/live-tracking/ReplayControls.tsx
"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, FastForward, Rewind } from 'lucide-react';
import { formatSecondsToHMS } from '@/lib/utils';

interface ReplayControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  replayTime: number;
  maxReplayTime: number;
  onSliderChange: (value: number[]) => void;
  replaySpeed: number;
  onSpeedChange: () => void;
}

export default function ReplayControls({
  isPlaying,
  onTogglePlay,
  replayTime,
  maxReplayTime,
  onSliderChange,
  replaySpeed,
  onSpeedChange
}: ReplayControlsProps) {

  return (
    <div className="p-4 bg-muted/50 rounded-lg border border-border">
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="flex items-center gap-2">
          <Button size="icon" onClick={onTogglePlay}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button size="icon" variant="outline" onClick={onSpeedChange}>
            <span className="text-xs font-semibold">{replaySpeed}x</span>
          </Button>
        </div>
        <div className="w-full flex-grow flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">{formatSecondsToHMS(replayTime)}</span>
          <Slider
            value={[replayTime]}
            onValueChange={onSliderChange}
            max={maxReplayTime}
            step={1}
            className="w-full"
          />
          <span className="text-xs font-mono text-muted-foreground">{formatSecondsToHMS(maxReplayTime)}</span>
        </div>
      </div>
    </div>
  );
}
