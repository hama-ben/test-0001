/**
 * AppealOverlay — shared full-screen blocking overlay with an integrated
 * appeal form.  Used for both:
 *
 *   • Rejected drivers  (reason = "rejected")  — in driver-dashboard.tsx
 *   • Banned users      (reason = "banned")    — in AccountStatusGate (App.tsx)
 *
 * The appeal form talks to GET/POST /api/appeal (the generic endpoint that
 * replaced the old /api/driver/appeal).
 */

import React, { useState, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import {
  Send,
  Loader2,
  Clock,
  CheckCheck,
  ExternalLink,
  MessageSquare,
} from "lucide-react";

interface AppealOverlayProps {
  /** Main heading — e.g. "تم رفض طلبك" | "حسابك محظور" */
  title: string;
  /** Body text shown in the status box when no appeal has been filed yet */
  idleDescription: string;
  /** Icon rendered inside the coloured circle at the top of the card */
  icon: React.ReactNode;
  /** Tailwind z-index class — defaults to "z-[200]" */
  zClass?: string;
}

export function AppealOverlay({
  title,
  idleDescription,
  icon,
  zClass = "z-[200]",
}: AppealOverlayProps) {
  const { userId } = useAuth();

  type AppealUIState = "loading" | "idle" | "form" | "submitting" | "done";
  const [appealStatus, setAppealStatus] = useState<AppealUIState>("loading");
  const [existingAppeal, setExistingAppeal] = useState<{ status: string } | null>(null);
  const [appealText, setAppealText]   = useState("");
  const [appealError, setAppealError] = useState("");

  // Fetch existing appeal on mount
  useEffect(() => {
    if (!userId) return;
    customFetch<{ status: string } | null>("/api/appeal")
      .then((data) => {
        if (data) setExistingAppeal(data);
        setAppealStatus("idle");
      })
      .catch(() => setAppealStatus("idle"));
  }, [userId]);

  const submitAppeal = async () => {
    if (!appealText.trim()) { setAppealError("يرجى كتابة نص الطعن"); return; }
    setAppealError("");
    setAppealStatus("submitting");
    try {
      await customFetch("/api/appeal", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: appealText.trim() }),
      });
      setExistingAppeal({ status: "pending" });
      setAppealStatus("done");
    } catch (err: unknown) {
      const apiErr = err as { data?: { error?: string } } | null;
      setAppealError(apiErr?.data?.error ?? "تعذّر الاتصال بالخادم");
      setAppealStatus("form");
    }
  };

  const hasPendingAppeal  = existingAppeal?.status === "pending";
  const hasReviewedAppeal = existingAppeal?.status === "reviewed";

  const bodyMessage = hasPendingAppeal
    ? "تم استلام طعنك وهو قيد المراجعة"
    : hasReviewedAppeal
      ? "تمت مراجعة طعنك. للمزيد من التفاصيل يرجى التواصل معنا"
      : idleDescription;

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/90 backdrop-blur-sm overflow-y-auto py-6`}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl p-7 mx-4 max-w-sm w-full shadow-2xl border border-red-200 dark:border-red-700 text-center animate-in zoom-in-95 duration-300"
        dir="rtl"
      >
        {/* Icon + title */}
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          {icon}
        </div>
        <h2 className="text-xl font-black text-slate-800 dark:text-white mb-3">
          {title}
        </h2>

        {/* Status message box */}
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-4 mb-5 text-right">
          {appealStatus === "loading" ? (
            <div className="flex items-center justify-center gap-2 text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">جارٍ التحميل...</span>
            </div>
          ) : (
            <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
              {bodyMessage}
            </p>
          )}
        </div>

        {/* Appeal form — only rendered while in "form" state */}
        {appealStatus === "form" && (
          <div className="mb-4 text-right space-y-3">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
              اكتب سبب طعنك أو أي توضيح تريد إضافته...
            </label>
            <textarea
              value={appealText}
              onChange={(e) => setAppealText(e.target.value)}
              rows={4}
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm text-slate-800 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="اشرح وضعك هنا..."
            />
            {appealError && (
              <p className="text-red-500 text-xs">{appealError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={submitAppeal}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-cyan-500 text-white font-bold py-3 rounded-2xl text-sm shadow-lg hover:opacity-90 transition-all active:scale-[0.98]"
              >
                <Send className="w-4 h-4" />
                إرسال الطعن
              </button>
              <button
                onClick={() => { setAppealStatus("idle"); setAppealError(""); }}
                className="px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* Done confirmation */}
        {appealStatus === "done" && (
          <div className="mb-4 flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-2xl p-4">
            <CheckCheck className="w-5 h-5 text-emerald-500 shrink-0" />
            <p className="text-sm text-emerald-700 dark:text-emerald-300 text-right">
              تم إرسال طعنك، سيتم مراجعته من الإدارة
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-3">
          {/* "Submit appeal" — only when idle with no pending/reviewed appeal */}
          {appealStatus === "idle" && !hasPendingAppeal && !hasReviewedAppeal && (
            <button
              onClick={() => setAppealStatus("form")}
              className="w-full inline-flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-[0.98] text-sm"
            >
              <MessageSquare className="w-4 h-4" />
              تقديم طعن
            </button>
          )}

          {/* Pending badge */}
          {hasPendingAppeal && (
            <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium">
              <Clock className="w-4 h-4" />
              طعنك قيد المراجعة
            </div>
          )}

          {/* Always-visible Facebook contact button */}
          <a
            href="https://www.facebook.com/profile.php?id=61590856328769"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all active:scale-[0.98] text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            تواصل مع الإدارة
          </a>
        </div>
      </div>
    </div>
  );
}
