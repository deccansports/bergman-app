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
        padding: 16,
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

export function CertificatePost({ data }: { data: any }) {
  if (!data) return null;

  const isFemale =
    data.gender?.toLowerCase() === "female" || data.gender === "F";

  const headerLogo = isFemale
    ? "/Bwwhitelogo.png"
    : "/Bmlogowhite.png";

  return (
    <CertificateShell width={1080} height={1350}>
      <div
        style={{
          padding: 48,
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
              margin: "0 auto 18px",
              objectFit: "contain",
            }}
          />

          <p
            style={{
              color: "#FFD200",
              letterSpacing: 2,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            FINISHER CERTIFICATE
          </p>
        </div>

        {/* ================= NAME + EVENT ================= */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
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
                fontSize: 46,
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              {cleanText(data.name)}
            </h1>
          </div>

          <p
            style={{
              fontSize: 16,
              color: "#cbd5e1",
              marginTop: 14,
              padding: "0 28px",
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
            border: "2px solid #FFD200",
            padding: 28,
            borderRadius: 14,
          }}
        >
          <p
            style={{
              fontSize: 14,
              letterSpacing: 2,
              color: "#FFD200",
              fontWeight: 600,
            }}
          >
            FINISH TIME
          </p>
          <p
            style={{
              fontSize: 68,
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
            gap: 18,
          }}
        >
          <Stat label="Overall Rank" value={data.overallRank} />
          <Stat label="Gender Rank" value={data.genderRank} />
          <Stat label="Category Rank" value={data.categoryRank} />
        </div>

        {/* ================= SPLITS ================= */}
        <div
          style={{
            textAlign: "left",
            fontSize: 15,
            padding: 18,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderRadius: 12,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              textAlign: "center",
              marginBottom: 12,
              color: "#FFD200",
            }}
          >
            YOUR SPLITS
          </h3>

          {data.splits?.map((s: any, idx: number) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "90px 1fr 1fr auto",
                alignItems: "center",
                gap: 16,
                padding: "6px 0",
              }}
            >
              <span style={{ fontWeight: 700 }}>{s.label}</span>
              <span style={{ color: "#94a3b8" }}>{s.distance}</span>
              <span style={{ color: "#94a3b8", textAlign: "right" }}>
                {s.pace}
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontWeight: 700,
                  textAlign: "right",
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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          {data.signatureUrl && (
            <img
              src={data.signatureUrl}
              alt="Signature"
              style={{ height: 52 }}
            />
          )}

          {data.qrCodeUrl && <CertificateQR dataUrl={data.qrCodeUrl} />}
        </div>
      </div>
    </CertificateShell>
  );
}