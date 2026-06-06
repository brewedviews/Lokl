/**
 * Card — neutral surface. `default` = rounded-card + p-4. `lg` = rounded-card-lg
 * + p-5 (matches the ProfileHeaderCard pattern in design_guidelines.json).
 */
import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  size?: "default" | "lg";
  shadow?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ size = "default", shadow = true, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-card-surface border border-card-border",
        size === "default" ? "rounded-card p-4" : "rounded-card-lg p-5 sm:p-6",
        shadow && "shadow-sm",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
