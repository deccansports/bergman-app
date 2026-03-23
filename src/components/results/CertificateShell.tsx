// src/components/results/CertificateShell.tsx
/* eslint-disable @next/next/no-img-element */
import React from "react";
import { cn } from "@/lib/utils";

export function CertificateShell({
  children,
  className = "",
  width,
  height,
}: {
  children: React.ReactNode;
  className?: string;
  width?: number;
  height?: number;
}) {
  const style: React.CSSProperties = {
    width,
    height,
    backgroundImage: "linear-gradient(180deg, #0B1325 0%, #0E1A35 100%)",
    color: "#ffffff",
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",

    /* Critical layout stability */
    position: "relative",
    display: "block",
    boxSizing: "border-box",
    overflow: "hidden",

    /* Text rendering stability for PNG / PDF */
    lineHeight: 1.4,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  };

  return (
    <div
      className={cn(
        "bg-[#0B1325] text-white font-sans select-none",
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}