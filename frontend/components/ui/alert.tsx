import * as React from "react";
import { cn } from "@/lib/utils";

function Alert({
  className,
  variant = "error",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "error" | "success" | "info" }) {
  const styles =
    variant === "error"
      ? "bg-red-50 text-red-700 border-red-200"
      : variant === "success"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-blue-50 text-blue-700 border-blue-200";
  return (
    <div
      role="alert"
      className={cn("rounded-lg border px-3 py-2 text-sm font-medium", styles, className)}
      {...props}
    />
  );
}

export { Alert };
