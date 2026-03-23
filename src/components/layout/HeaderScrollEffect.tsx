"use client";

import { useEffect } from "react";

export function HeaderScrollEffect() {
  useEffect(() => {
    const logo = document.getElementById("center-logo");

    const onScroll = () => {
      if (!logo) return;
      const scrolled = window.scrollY > 40;
      logo.style.transform = scrolled
        ? "translateX(-50%) scale(0.85)"
        : "translateX(-50%) scale(1)";
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
