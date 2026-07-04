// src/components/AthleteHubLoader.tsx
"use client";

import { Loader2 } from 'lucide-react';

export default function AthleteHubLoader() {
  return (
    <div style={styles.wrapper}>
      <div style={styles.loaderContainer}>
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
        <p style={styles.text}>Loading Athlete Hub...</p>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "hsl(var(--background))",
    zIndex: 9999,
  },
  loaderContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  },
  text: {
    color: 'hsl(var(--foreground))',
    fontSize: '1.125rem', // text-lg
    marginTop: '1rem',
  },
};
