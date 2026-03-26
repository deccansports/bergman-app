// src/components/live-tracking/ElevationProfileChart.tsx
"use client";

import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

interface ElevationDataPoint {
  distance: number;
  elevation: number;
}

interface ElevationProfileChartProps {
  data: ElevationDataPoint[];
  strokeColor?: string;
  athleteProgress?: number; // Athlete's progress in km
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


export default function ElevationProfileChart({ data, strokeColor = "#8884d8", athleteProgress, height = 150 }: ElevationProfileChartProps) {
  if (!data || data.length === 0) {
    return <div className="text-center text-sm text-muted-foreground">No elevation data available.</div>;
  }

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
          <Area type="monotone" dataKey="elevation" stroke={strokeColor} fill={strokeColor} fillOpacity={0.2} />

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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
