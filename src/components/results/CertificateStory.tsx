/* eslint-disable @next/next/no-img-element */
import React from "react";
import { CertificateShell } from "./CertificateShell";
import { CertificateQR } from "./CertificateQR";
import { cleanText } from "@/lib/utils";

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
        padding: 18,
        borderRadius: 10,
      }}
    >
      <p style={{ fontSize: 14, color: "#cbd5e1" }}>{label}</p>
      <p style={{ fontSize: 34, fontWeight: 700, marginTop: 6 }}>
        {value ?? "—"}
      </p>
    </div>
  );
}

export function CertificateStory({ data }: { data: any }) {
  if (!data) return null;

  const isFemale =
    data.gender?.toLowerCase() === "female" || data.gender === "F";

  const headerLogo = isFemale
    ? "/Bwwhitelogo.png"
    : "/Bmlogowhite.png";

  return (
    <CertificateShell width={1080} height={1920}>
      <div
        style={{
          padding: 64,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          textAlign: "center",
        }}
      >
        {/* ================= HEADER ================= */}
        <div>
          <img
            src={headerLogo}
            alt="Bergman Logo"
            style={{
              height: 56,
              objectFit: "contain",
              margin: "0 auto 20px",
            }}
          />

          <p
            style={{
              color: "#FFD200",
              letterSpacing: 3,
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            OFFICIAL FINISHER
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              marginTop: 96,
            }}
          >
            {data.flagSrc && (
              <img
                src={data.flagSrc}
                alt="Country Flag"
                style={{ height: 48, borderRadius: 6 }}
              />
            )}
            <h1
              style={{
                fontSize: 56,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {cleanText(data.name)}
            </h1>
          </div>

          <p
            style={{
              fontSize: 20,
              color: "#cbd5e1",
              marginTop: 18,
              padding: "0 32px",
              lineHeight: 1.55,
            }}
          >
            In recognition of determination, resilience, and athletic excellence.
            This certificate is awarded for the successful completion of the{" "}
            <span style={{ fontWeight: 700, color: "#FFD200" }}>
              {data.eventName}
            </span>{" "}
            held on {data.date}, in the {data.category}.
          </p>
        </div>

        {/* ================= FINISH TIME ================= */}
        <div
          style={{
            border: "3px solid #FFD200",
            padding: 44,
            borderRadius: 18,
            marginTop: 40,
          }}
        >
          <p
            style={{
              fontSize: 18,
              letterSpacing: 3,
              color: "#FFD200",
              fontWeight: 600,
            }}
          >
            FINISH TIME
          </p>
          <p
            style={{
              fontSize: 86,
              fontFamily: "monospace",
              fontWeight: 800,
              marginTop: 16,
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
            gap: 28,
            marginTop: 36,
          }}
        >
          <Stat label="Overall Rank" value={data.overallRank} />
          <Stat label="Gender Rank" value={data.genderRank} />
          <Stat label="Category Rank" value={data.categoryRank} />
        </div>

        {/* ================= SPLITS ================= */}
        {Array.isArray(data.splits) && data.splits.length > 0 && (
          <div
            style={{
              marginTop: 48,
              background: "rgba(0,0,0,0.35)",
              borderRadius: 18,
              padding: "28px 36px",
              textAlign: "left",
            }}
          >
            <p
              style={{
                textAlign: "center",
                color: "#FFD200",
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 18,
                letterSpacing: 1,
              }}
            >
              YOUR SPLITS
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {data.splits.map((split: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto auto",
                    gap: 16,
                    fontSize: 20,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{split.label}</span>
                  <span style={{ color: "#94a3b8" }}>{split.distance}</span>
                  <span style={{ color: "#94a3b8" }}>{split.pace}</span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      textAlign: "right",
                      fontWeight: 600,
                    }}
                  >
                    {split.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================= FOOTER ================= */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            width: "100%",
          }}
        >
          {/* Signature */}
          {data.signatureUrl && (
            <img
              src={data.signatureUrl}
              alt="Signature"
              style={{ height: 64 }}
            />
          )}

          {/* QR */}
          {data.qrCodeUrl && (
            <div style={{ textAlign: "center" }}>
              <CertificateQR dataUrl={data.qrCodeUrl} />
              <p
                style={{
                  fontSize: 12,
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