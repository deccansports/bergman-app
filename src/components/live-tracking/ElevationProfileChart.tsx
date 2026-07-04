// src/components/live-tracking/ElevationProfileChart.tsx
"use client";

import React, { useId } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, ReferenceDot } from 'recharts';

interface ElevationDataPoint {
  distance: number;
  elevation: number;
}

interface ElevationProfileChartProps {
  data: ElevationDataPoint[];
  strokeColor?: string;
  athleteProgress?: number; // Athlete's progress in km
  athleteMarkers?: { progress: number; label: string; color?: string; athleteName?: string }[];
  height?: number; // Optional height prop
}

const ReferenceLineLabel: React.FC<any> = (props) => {
  const {viewBox, value, fill} = props;
  const {x, y} = viewBox;
  return (
    <text x={x} y={y - 5} dy={0} dx={0} fill={fill} fontSize={10} textAnchor="middle">
      {value}
    </text>
  );
};


export default function ElevationProfileChart({ data, strokeColor = "#f59e0b", athleteProgress, athleteMarkers = [], height = 150 }: ElevationProfileChartProps) {
  const gradientId = useId();
  const fillGradientId = `${gradientId}-fill`;
  const strokeGradientId = `${gradientId}-stroke`;

  if (!data || data.length === 0) {
    return <div className="text-center text-sm text-muted-foreground">No elevation data available.</div>;
  }

  const getElevationAtDistance = (distanceKm: number) => {
    const nearest = data.reduce((best, point) => {
      return Math.abs(point.distance - distanceKm) < Math.abs(best.distance - distanceKm) ? point : best;
    }, data[0]);
    return nearest?.elevation ?? data[0]?.elevation ?? 0;
  };

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart
          data={data}
          margin={{
            top: 5,
            right: 20,
            left: -10,
            bottom: 5,
          }}
        >
          <defs>
            <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dc2626" stopOpacity={0.45} />
              <stop offset="45%" stopColor={strokeColor} stopOpacity={0.35} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={0.28} />
            </linearGradient>
            <linearGradient id={strokeGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dc2626" stopOpacity={1} />
              <stop offset="45%" stopColor={strokeColor} stopOpacity={1} />
              <stop offset="100%" stopColor="#16a34a" stopOpacity={1} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
          <XAxis 
            dataKey="distance"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value) => `${Math.round(value)}km`}
            fontSize={10}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            stroke="hsl(var(--border))"
          />
          <YAxis 
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value) => `${Math.round(value)}m`} 
            fontSize={10}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            stroke="hsl(var(--border))"
          />
          <Tooltip 
            contentStyle={{
                backgroundColor: 'hsl(var(--background))',
                border: '1px solid hsl(var(--border))',
                fontSize: '12px'
            }}
            labelFormatter={(label) => `Distance: ${label.toFixed(2)} km`}
            formatter={(value: number) => [`${value.toFixed(1)} m`, 'Elevation']}
          />
          <Area
            type="monotone"
            dataKey="elevation"
            stroke={`url(#${strokeGradientId})`}
            strokeWidth={2.5}
            fill={`url(#${fillGradientId})`}
          />

          {athleteProgress !== undefined && athleteProgress >= 0 && (
            <ReferenceLine 
              x={athleteProgress} 
              stroke="hsl(var(--primary))" 
              strokeWidth={2}
              strokeDasharray="3 3" 
            >
              <ReferenceLineLabel value={`${athleteProgress.toFixed(1)}km`} position="insideTopRight" fill="hsl(var(--primary))" fontSize={10} />
            </ReferenceLine>
          )}

          {athleteMarkers.map((marker, idx) => (
            <React.Fragment key={`${marker.label}-${idx}-${marker.progress}`}>
              <ReferenceLine
                x={marker.progress}
                stroke={marker.color || 'hsl(var(--primary))'}
                strokeWidth={2}
                strokeOpacity={0.7}
              />
              <ReferenceDot
                x={marker.progress}
                y={getElevationAtDistance(marker.progress)}
                r={6}
                fill={marker.color || 'hsl(var(--primary))'}
                stroke="#fff"
                strokeWidth={2}
                label={{
                  value: marker.label,
                  position: 'top',
                  fill: marker.color || 'hsl(var(--primary))',
                  fontSize: 10,
                }}
              />
            </React.Fragment>
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
