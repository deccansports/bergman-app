/* eslint-disable @next/next/no-img-element */
import React from "react";
import { CertificateShell } from "./CertificateShell";
import { CertificateQR } from "./CertificateQR";
import { cleanText } from "@/lib/utils";

type Split = {
  label: string;
  distance: string;
  pace: string;
  time: string;
};

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined | null;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        padding: "16px",
        borderRadius: 10,
      }}
    >
      <p style={{ fontSize: 14, color: "#cbd5e1" }}>{label}</p>
      <p style={{ fontSize: 34, fontWeight: 700, marginTop: 4 }}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function SplitRow({ split }: { split: Split }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 10,
        padding: "12px 14px",
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 8,
        fontSize: 14,
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 700 }}>{split.label}</div>
      <div style={{ textAlign: "right", color: "#cbd5e1" }}>
        {split.distance}
      </div>
      <div style={{ textAlign: "right", color: "#cbd5e1" }}>
        {split.pace}
      </div>
      <div
        style={{
          textAlign: "right",
          fontFamily: "monospace",
          fontWeight: 700,
        }}
      >
        {split.time}
      </div>
    </div>
  );
}

export function CertificateSquare({ data }: { data: any }) {
  if (!data) return null;

  const isFemale =
    data.gender?.toLowerCase() === "female" ||
    data.gender === "F";

  const headerLogo = isFemale
    ? "/Bwwhitelogo.png"
    : "/Bmlogowhite.png";

  return (
    <CertificateShell width={1080} height={1080}>
      <div
        style={{
          padding: 48,
          height: "100%",
          display: "grid",
          gridTemplateRows: "auto auto auto 1fr auto",
          gap: 28,
          textAlign: "center",
        }}
      >
        {/* ================= HEADER ================= */}
        <div>
          <img
            src={headerLogo}
            alt="Bergman Logo"
            style={{
              height: 48,
              margin: "0 auto",
              objectFit: "contain",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              marginTop: 22,
            }}
          >
            {data.flagSrc && (
              <img
                src={data.flagSrc}
                alt="Country Flag"
                style={{ height: 40, borderRadius: 6 }}
              />
            )}
            <h1
              style={{
                fontSize: 44,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {cleanText(data.name)}
            </h1>
          </div>

          <p
            style={{
              color: "#FFD200",
              marginTop: 10,
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {data.eventName}
          </p>
        </div>

        {/* ================= FINISH TIME ================= */}
        <div
          style={{
            border: "2px solid #FFD200",
            padding: 22,
            borderRadius: 14,
          }}
        >
          <p
            style={{
              fontSize: 12,
              letterSpacing: 3,
              color: "#FFD200",
              fontWeight: 600,
            }}
          >
            FINISH TIME
          </p>
          <p
            style={{
              fontSize: 58,
              fontFamily: "monospace",
              fontWeight: 800,
              marginTop: 10,
            }}
          >
            {data.finishTime}
          </p>
        </div>

        {/* ================= RANKS ================= */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 14,
          }}
        >
          <Stat label="Overall" value={data.overallRank} />
          <Stat label="Gender" value={data.genderRank} />
          <Stat label="Category" value={data.categoryRank} />
        </div>

        {/* ================= SPLITS ================= */}
        <div style={{ textAlign: "left" }}>
          <p
            style={{
              fontSize: 14,
              fontWeight: 700,
              marginBottom: 10,
              color: "#FFD200",
              textAlign: "center",
              letterSpacing: 1,
            }}
          >
            RACE SPLITS
          </p>

          <div style={{ display: "grid", gap: 10 }}>
            {data.splits?.map((split: Split, idx: number) => (
              <SplitRow key={idx} split={split} />
            ))}
          </div>
        </div>

        {/* ================= FOOTER ================= */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            width: "100%",
            marginTop: "auto",
          }}
        >
          {/* Signature */}
          <img
            src="/white signature.png"
            alt="Signature"
            style={{ height: 50 }}
          />

          {/* QR */}
          {data.qrCodeUrl && (
            <div style={{ textAlign: "right" }}>
              <CertificateQR dataUrl={data.qrCodeUrl} />
              <p
                style={{
                  fontSize: 10,
                  color: "#94a3b8",
                  marginTop: 6,
                }}
              >
                Verify
              </p>
            </div>
          )}
        </div>
      </div>
    </CertificateShell>
  );
}