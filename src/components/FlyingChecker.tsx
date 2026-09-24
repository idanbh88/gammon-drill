"use client";

import { useEffect, useRef } from "react";
import type { Flight } from "@/lib/board-animation";
import { Checker } from "./Board";

/** One checker gliding from one slot to another (Web Animations API), lifting a little on the way. */
export default function FlyingChecker({ flight }: { flight: Flight }) {
  const ref = useRef<SVGGElement>(null);
  const { from, to, ms } = flight;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const mid = { x: (from.cx + to.cx) / 2, y: (from.cy + to.cy) / 2 };
    const animation = el.animate(
      [
        { transform: `translate(${from.cx}px, ${from.cy}px) scale(1)` },
        { transform: `translate(${mid.x}px, ${mid.y}px) scale(1.12)`, offset: 0.5 },
        { transform: `translate(${to.cx}px, ${to.cy}px) scale(1)` },
      ],
      { duration: ms, easing: "ease-in-out", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [from.cx, from.cy, to.cx, to.cy, ms]);
  return (
    <g ref={ref} style={{ transform: `translate(${from.cx}px, ${from.cy}px)` }} data-flight={`${Math.round(from.cx)},${Math.round(from.cy)}>${Math.round(to.cx)},${Math.round(to.cy)}`}>
      <Checker cx={0} cy={0} mine={flight.mine} lifted />
    </g>
  );
}
