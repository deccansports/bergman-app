"use client";

import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted shadow-sm", className)} // Added shadow-sm
      {...props}
    />
  )
}

export { Skeleton }
