// src/components/results/CertificateQR.tsx
/* eslint-disable @next/next/no-img-element */
import React from "react";

export function CertificateQR({
  dataUrl,
  size = 80,
}: {
  dataUrl: string | null;
  size?: number;
}) {
  if (!dataUrl) return null;

  return (
    <div
      style={{
        width: size + 8,
        height: size + 8,
        backgroundColor: "#ffffff",
        padding: 4,
        borderRadius: 6,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <img
        src={dataUrl}
        alt="Verification QR Code"
        width={size}
        height={size}
        style={{
          display: "block",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}