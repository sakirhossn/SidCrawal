"use client";

import React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type AnimatedButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  children?: React.ReactNode;
};

/**
 * Adapted from Vengeance UI (@vengeanceui/animated-button) with strict TypeScript
 * typing, Emerald/Neutral border highlight, and prefers-reduced-motion support.
 */
export function AnimatedButton({
  children = "Get Started",
  className = "",
  ...rest
}: AnimatedButtonProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.button
      {...rest}
      whileHover={prefersReducedMotion ? undefined : { scale: 1.01 }}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
      transition={{
        type: "spring",
        stiffness: 460,
        damping: 32,
        mass: 0.5,
      }}
      className={cn(
        "group relative inline-flex h-10 items-center justify-center gap-2 overflow-hidden rounded-lg border border-border bg-primary px-5 text-sm font-medium text-primary-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "[--shine:rgba(16,185,129,0.55)] dark:[--shine:rgba(16,185,129,0.75)]",
        className
      )}
    >
      <span className="relative z-10 inline-flex items-center gap-2">
        {children}
      </span>

      {!prefersReducedMotion && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-lg p-px"
          style={{
            background:
              "linear-gradient(-75deg, transparent 32%, var(--shine) 50%, transparent 68%)",
            backgroundSize: "200% 100%",
            mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            maskComposite: "exclude",
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
          }}
          initial={{ backgroundPosition: "100% 0", opacity: 0 }}
          animate={{ backgroundPosition: ["100% 0", "0% 0"], opacity: [0, 0.85, 0] }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            ease: "linear",
            repeatDelay: 2.2,
          }}
        />
      )}
    </motion.button>
  );
}

export default AnimatedButton;
