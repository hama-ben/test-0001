import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { DriverDocsUpload, VerifiedSession } from "@/pages/register";
import { WaterDrops } from "@/components/layout";
import { Loader2 } from "lucide-react";

export default function DriverUploadDocs() {
  const [, setLocation] = useLocation();
  const userId   = useAuth((s) => s.userId);
  const name     = useAuth((s) => s.name);
  const email    = useAuth((s) => s.email);
  const userType = useAuth((s) => s.userType);

  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (!userId || userType !== "سائق") {
      setLocation("/");
    }
  }, [isHydrated, userId, userType, setLocation]);

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center" dir="rtl">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!userId || userType !== "سائق") return null;

  const session: VerifiedSession = {
    userId,
    name:     name ?? "",
    email:    email ?? "",
    userType: userType,
  };

  const handleComplete = () => {
    setLocation("/driver-dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-start px-4 pt-12 pb-8" dir="rtl">
      <WaterDrops />
      <div className="w-full max-w-md glass-panel rounded-3xl p-6 shadow-2xl relative z-10">
        <DriverDocsUpload session={session} onComplete={handleComplete} />
      </div>
    </div>
  );
}
