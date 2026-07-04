/* eslint-disable @next/next/no-img-element */
import React from "react";
import { CertificateShell } from "./CertificateShell";
import { CertificateQR } from "./CertificateQR";
import { cleanText } from "@/lib/utils";

function RankStat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
        padding: "48px 24px",
        borderRadius: 20,
      }}
    >
      <p style={{ fontSize: 32, color: "#cbd5e1", marginBottom: 12 }}>
        {label}
      </p>
      <p style={{ fontSize: 72, fontWeight: 800 }}>
        {value ?? "—"}
      </p>
    </div>
  );
}

export function CertificatePrint({ data }: { data: any }) {
  if (!data) return null;

  return (
    <CertificateShell width={2480} height={3508}>
      <div
        style={{
          padding: 140,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ================= HEADER ================= */}
        <div style={{ textAlign: "center", marginBottom: 120 }}>
          {data.logoUrl && (
            <img
              src={data.logoUrl}
              alt="Bergman Logo"
              style={{
                height: 140,
                margin: "0 auto 32px",
                objectFit: "contain",
                display: "block",
              }}
            />
          )}
          <p
            style={{
              fontSize: 36,
              letterSpacing: 6,
              fontWeight: 700,
              color: "#FFD200",
            }}
          >
            FINISHER CERTIFICATE
          </p>
        </div>

        {/* ================= NAME & MESSAGE ================= */}
        <div
          style={{
            textAlign: "center",
            maxWidth: 1800,
            margin: "0 auto 120px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 32,
              marginBottom: 32,
            }}
          >
            {data.flagSrc && (
              <img
                src={data.flagSrc}
                alt="Country"
                style={{ height: 72, borderRadius: 8 }}
              />
            )}
            <h1
              style={{
                fontSize: 110,
                fontWeight: 900,
                letterSpacing: 1,
                lineHeight: 1.05,
              }}
            >
              {cleanText(data.name)}
            </h1>
          </div>

          <p
            style={{
              fontSize: 34,
              lineHeight: 1.7,
              color: "#e2e8f0",
            }}
          >
            In recognition of determination, resilience, and athletic excellence.
            This certificate is proudly awarded for successfully completing the{" "}
            <span style={{ color: "#FFD200", fontWeight: 700 }}>
              {data.eventName}
            </span>{" "}
            held on {data.date} in the{" "}
            <strong>{data.category}</strong>.
          </p>
        </div>

        {/* ================= FINISH TIME ================= */}
        <div
          style={{
            width: "100%",
            border: "4px solid #FFD200",
            borderRadius: 28,
            padding: "64px 48px",
            textAlign: "center",
            marginBottom: 120,
          }}
        >
          <p
            style={{
              fontSize: 36,
              letterSpacing: 5,
              fontWeight: 700,
              color: "#FFD200",
              marginBottom: 16,
            }}
          >
            FINISH TIME
          </p>
          <p
            style={{
              fontSize: 140,
              fontFamily: "monospace",
              fontWeight: 900,
              letterSpacing: 2,
            }}
          >
            {data.finishTime}
          </p>
        </div>

        {/* ================= RANKS ================= */}
        <div
          style={{
            display: "flex",
            gap: 40,
            width: "100%",
            marginBottom: 120,
          }}
        >
          <RankStat label="Overall Rank" value={data.overallRank} />
          <RankStat label="Gender Rank" value={data.genderRank} />
          <RankStat label="Category Rank" value={data.categoryRank} />
        </div>

        {/* ================= SPLITS ================= */}
        <div
          style={{
            width: "100%",
            backgroundColor: "rgba(255,255,255,0.07)",
            border: "3px solid rgba(255,255,255,0.16)",
            padding: 80,
            borderRadius: 32,
          }}
        >
          <h3
            style={{
              fontSize: 48,
              fontWeight: 800,
              textAlign: "center",
              marginBottom: 56,
            }}
          >
            Your Splits
          </h3>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "240px 1fr 1fr 240px",
              fontSize: 38,
              fontWeight: 700,
              color: "#e2e8f0",
              borderBottom: "3px solid rgba(255,255,255,0.25)",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderRadius: 20,
              padding: "22px 28px",
              marginBottom: 24,
            }}
          >
            <span>Segment</span>
            <span style={{ textAlign: "right" }}>Distance</span>
            <span style={{ textAlign: "right" }}>Pace</span>
            <span style={{ textAlign: "right" }}>Time</span>
          </div>

          {data.splits.map((s: any, i: number) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "240px 1fr 1fr 240px",
                padding: "32px 28px",
                fontSize: 42,
                backgroundColor: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "transparent",
                borderBottom:
                  i === data.splits.length - 1
                    ? "none"
                    : "2px solid rgba(255,255,255,0.15)",
              }}
            >
              <span style={{ fontWeight: 800 }}>{s.label}</span>
              <span style={{ textAlign: "right" }}>{s.distance}</span>
              <span style={{ textAlign: "right" }}>{s.pace}</span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: "monospace",
                  fontWeight: 900,
                  fontSize: 44,
                }}
              >
                {s.time}
              </span>
            </div>
          ))}
        </div>

        {/* ================= FOOTER ================= */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            paddingTop: 80,
          }}
        >
          <img
            src={data.signatureUrl || "/white signature.png"}
            alt="Signature"
            style={{ height: 210, objectFit: "contain" }}
          />

          {data.qrCodeUrl && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
              }}
            >
              <CertificateQR dataUrl={data.qrCodeUrl} size={160} />
              <p style={{ fontSize: 18, color: "#94a3b8", margin: 0, lineHeight: 1.3, textAlign: "center" }}>
                Scan to verify
              </p>
            </div>
          )}
        </div>
      </div>
    </CertificateShell>
  );
}