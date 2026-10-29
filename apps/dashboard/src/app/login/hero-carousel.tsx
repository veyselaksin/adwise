"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@lib/utils";

/** Unsplash photos (Unsplash License, attribution optional). The first matches the API docs sign-in. */
const SLIDES = [
  {
    photo: "photo-1551288049-bebda4e38f71",
    title: "Livensa ad performance",
    text: "Spend, installs, trials and CAC across Meta and TikTok, every day.",
  },
  {
    photo: "photo-1460925895917-afdab827c52f",
    title: "Numbers you can trust",
    text: "One set of definitions, shared by the dashboard and the agent.",
  },
  {
    photo: "photo-1533750349088-cd871a92f312",
    title: "Countries first, then blended",
    text: "Compare channels where it matters, the way the team does.",
  },
  {
    photo: "photo-1551434678-e076c223a692",
    title: "Ask the agent",
    text: "Questions the dashboard can't answer, from the same data.",
  },
];

const INTERVAL_MS = 7000;

/**
 * The panel is taller than the 3:2 photos, so object-cover scales them by
 * height: the rendered width is ~1.5x the panel height, not the panel width.
 */
const SIZES = "(min-width: 1024px) max(55vw, calc((100svh - 24px) * 1.5)), 0px";

export function HeroCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Respect reduced motion: stay on the current photo.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % SLIDES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [index]);

  return (
    <aside className="relative m-3 hidden overflow-hidden rounded-2xl bg-neutral-950 lg:block">
      {SLIDES.map((slide, i) => (
        <Image
          key={slide.photo}
          src={`https://images.unsplash.com/${slide.photo}`}
          alt=""
          fill
          quality={90}
          sizes={SIZES}
          priority={i === 0}
          loading={i === 0 ? undefined : "eager"}
          className={cn(
            "object-cover object-left transition-opacity duration-1000 ease-in-out",
            i === index ? "opacity-100" : "opacity-0",
          )}
        />
      ))}
      <div className="absolute inset-0 bg-linear-to-b from-black/0 from-55% to-black/40 dark:from-black/15 dark:from-40% dark:to-black/60" />

      <a
        href="https://unsplash.com"
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        className="absolute top-3.5 right-4 rounded-full bg-black/35 px-2 py-0.5 text-[11px] text-white/80 hover:text-white"
      >
        Photo · Unsplash
      </a>

      <div
        className="absolute right-5 bottom-5 left-5 rounded-xl border border-white/15 bg-white/10 p-5 text-neutral-50 shadow-lg ring-1 ring-black/5 backdrop-blur-xl backdrop-saturate-150 xl:right-auto xl:max-w-md dark:bg-black/25"
        aria-live="polite"
      >
        <div className="grid">
          {SLIDES.map((slide, i) => (
            <div
              key={slide.photo}
              aria-hidden={i !== index}
              className={cn(
                "col-start-1 row-start-1 transition-all duration-700",
                i === index ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
              )}
            >
              <strong className="mb-1 block text-xl tracking-tight">{slide.title}</strong>
              <span className="text-sm text-neutral-50/80">{slide.text}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-1.5">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.photo}
              type="button"
              aria-label={`Show slide ${i + 1}: ${slide.title}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "h-1 rounded-full transition-all duration-500",
                i === index ? "w-6 bg-white" : "w-3 bg-white/40 hover:bg-white/70",
              )}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
