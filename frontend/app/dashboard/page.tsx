"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { getDefaultNavKey } from "@/lib/roles";
import { Spinner } from "@/components/ui/spinner";

export default function DashboardIndexPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    router.replace(`/dashboard/${getDefaultNavKey(user)}`);
  }, [user, router]);

  return (
    <div className="flex flex-1 items-center justify-center py-20">
      <Spinner className="h-6 w-6 text-red-600" />
    </div>
  );
}
