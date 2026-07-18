/**
 * CustomerServiceModal
 *
 * A full-screen modal form that lets users (driver or consumer)
 * send a support message to the Mizu support team.
 * The message is forwarded to the support email via /api/support/contact.
 */

import { useState } from "react";
import { X, Send, CheckCircle2, Loader2, HeadphonesIcon } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

interface CustomerServiceModalProps {
  userName: string;
  userEmail: string;
  userType: string;
  onClose: () => void;
}

export function CustomerServiceModal({ userName, userEmail, userType, onClose }: CustomerServiceModalProps) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [done, setDone]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 10) {
      setError("يرجى كتابة رسالة أكثر تفصيلاً (10 أحرف على الأقل)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await customFetch("/api/support/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:     userName,
          email:    userEmail,
          message:  message.trim(),
          userType,
        }),
      });
      setDone(true);
    } catch (err: any) {
      setError(err?.data?.error ?? "تعذّر إرسال الرسالة. يرجى المحاولة لاحقاً.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      dir="rtl"
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl flex items-center justify-center">
            <HeadphonesIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="font-black text-slate-800 dark:text-white">خدمة العملاء</h2>
            <p className="text-xs text-slate-400">سنرد عليك في أقرب وقت ممكن</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
            </div>
            <h3 className="font-bold text-slate-800 dark:text-white text-lg">تم إرسال رسالتك!</h3>
            <p className="text-slate-500 text-sm">شكراً على تواصلك معنا. سيرد فريق الدعم عليك قريباً على بريدك الإلكتروني.</p>
            <button
              onClick={onClose}
              className="mt-2 w-full py-3 rounded-2xl font-bold text-white bg-gradient-to-r from-primary to-cyan-500 shadow-md shadow-primary/25 hover:opacity-90 transition-all"
            >
              إغلاق
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* User info (read-only) */}
            <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-primary font-black text-sm">{userName.charAt(0)}</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{userName}</p>
                <p className="text-xs text-slate-400 truncate">{userEmail}</p>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                {userType === "سائق" ? "سائق" : "مستهلك"}
              </span>
            </div>

            {/* Message textarea */}
            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5 block">
                رسالتك *
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="اشرح مشكلتك أو استفسارك بالتفصيل..."
                rows={5}
                maxLength={1000}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/40 bg-white dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400"
              />
              <p className="text-xs text-slate-400 text-left mt-1">{message.length} / 1000</p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-3 text-sm text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || message.trim().length < 10}
              className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 font-bold text-white bg-gradient-to-r from-primary to-cyan-500 shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <><Loader2 className="w-5 h-5 animate-spin" />جارٍ الإرسال...</>
              ) : (
                <><Send className="w-5 h-5" />إرسال الرسالة</>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
