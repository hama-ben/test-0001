/**
 * Admin Support Panel — /admin
 *
 * Secured with a sessionStorage-held admin key (X-Admin-Key header).
 * Shows all support threads and lets the admin reply in real-time.
 * Admin replies are pushed to the user instantly via Socket.io (server calls
 * emitToUser) — the user sees the reply in SupportChatModal without refreshing.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  HeadphonesIcon, Send, Loader2, RefreshCw, LogOut,
  MessageSquare, User, Phone, Clock, CheckCheck,
  ChevronRight, Inbox, AlertCircle, Banknote, CalendarDays,
  CheckCircle2, XCircle, Receipt, ExternalLink,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ThreadSummary {
  userId:        string | null;
  userName:      string;
  userPhone:     string | null;
  userType:      string | null;
  lastMessage:   string;
  lastMessageAt: string | null;
  senderType:    string;
  pendingCount:  number;
  totalMessages: number;
}

interface SupportMessage {
  id:         string;
  userId:     string | null;
  message:    string;
  senderType: string;
  adminId:    string | null;
  status:     string;
  createdAt:  string;
}

interface ThreadDetail {
  user: {
    id:       string;
    name:     string;
    phone:    string | null;
    userType: string | null;
    wilaya:   string | null;
    commune:  string | null;
  };
  messages: SupportMessage[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_KEY_SS = "mizu_admin_key";

function apiHeaders(adminKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Admin-Key":  adminKey,
  };
}

async function adminFetch<T>(path: string, adminKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...apiHeaders(adminKey), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return "أمس";
    if (diffDays < 7) return `منذ ${diffDays} أيام`;
    return d.toLocaleDateString("ar-DZ", { day: "numeric", month: "short" });
  } catch { return ""; }
}

function formatFull(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-DZ", {
      day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

// ── Payment types ─────────────────────────────────────────────────────────────

interface PaymentRow {
  id:                   string;
  driverId:             string;
  receiptImage:         string;
  months:               number;
  status:               string;
  adminNotes:           string | null;
  createdAt:            string | null;
  reviewedAt:           string | null;
  driverName:           string | null;
  driverPhone:          string | null;
  driverWilaya:         string | null;
  subscriptionExpiresAt: string | null;
}

// ── Payments Panel ────────────────────────────────────────────────────────────

function PaymentsPanel({ adminKey }: { adminKey: string }) {
  const [payments, setPayments]       = useState<PaymentRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [actionId, setActionId]       = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [error, setError]             = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const rows = await adminFetch<PaymentRow[]>(`/api/admin/payments?status=${filter}`, adminKey);
      setPayments(rows ?? []);
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : "تعذّر تحميل الوصولات");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [adminKey, filter]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    setActionId(id);
    try {
      await adminFetch(`/api/admin/payments/${id}/approve`, adminKey, { method: "POST" });
      load(true);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "خطأ في القبول");
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setActionId(rejectTarget);
    try {
      await adminFetch(`/api/admin/payments/${rejectTarget}/reject`, adminKey, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      setRejectTarget(null);
      setRejectReason("");
      load(true);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "خطأ في الرفض");
    } finally {
      setActionId(null);
    }
  };

  const monthsLabel = (m: number) =>
    m === 1 ? "شهر واحد (30 يوم)" : `${m} أشهر (${m * 30} يوم)`;

  const statusBadge = (s: string) => {
    if (s === "approved") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">مقبول ✓</span>;
    if (s === "rejected") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">مرفوض</span>;
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">قيد المراجعة</span>;
  };

  const pendingCount = filter === "pending" ? payments.length : 0;

  return (
    <div className="flex flex-col h-full overflow-hidden" dir="rtl">
      {/* Header + filter tabs */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            <span className="font-bold text-slate-800 dark:text-white text-sm">وصولات الدفع</span>
            {pendingCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingCount}</span>
            )}
          </div>
          <button
            onClick={() => load()}
            disabled={loading}
            className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex gap-1.5 text-xs">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all ${
                filter === f
                  ? "bg-primary text-white shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {{ pending: "معلق", approved: "مقبول", rejected: "مرفوض", all: "الكل" }[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-slate-500">{error}</p>
            <button onClick={() => load()} className="text-xs text-primary font-bold flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> إعادة المحاولة
            </button>
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Banknote className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-slate-400">لا توجد وصولات</p>
          </div>
        ) : (
          payments.map((p) => (
            <div key={p.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
              {/* Driver info row */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800 dark:text-white text-sm">{p.driverName ?? "—"}</span>
                    {statusBadge(p.status)}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                    {p.driverPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{p.driverPhone}</span>}
                    {p.driverWilaya && <span>{p.driverWilaya}</span>}
                    {p.createdAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatTime(p.createdAt)}</span>}
                  </div>
                </div>
              </div>

              {/* Duration + current expiry */}
              <div className="px-4 py-3 bg-primary/5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium">المدة المطلوبة</p>
                    <p className="text-sm font-black text-primary">{monthsLabel(p.months ?? 1)}</p>
                  </div>
                </div>
                <div className="text-left rtl:text-right">
                  <p className="text-[10px] text-slate-400 font-medium">اشتراكه الحالي ينتهي</p>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {p.subscriptionExpiresAt
                      ? new Date(p.subscriptionExpiresAt).toLocaleDateString("ar-DZ", { day: "numeric", month: "long", year: "numeric" })
                      : "منتهي / غير مشترك"}
                  </p>
                </div>
              </div>

              {/* Receipt image preview */}
              <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800">
                <div
                  className="w-16 h-16 rounded-xl overflow-hidden border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 cursor-pointer hover:border-primary transition-colors shrink-0"
                  onClick={() => setPreviewUrl(p.receiptImage)}
                >
                  <img
                    src={p.receiptImage}
                    alt="وصل الدفع"
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 mb-1">صورة الوصل — اضغط للتكبير</p>
                  <button
                    onClick={() => setPreviewUrl(p.receiptImage)}
                    className="flex items-center gap-1.5 text-xs text-primary font-bold hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> عرض الوصل
                  </button>
                </div>
              </div>

              {/* Admin notes (if rejected) */}
              {p.adminNotes && (
                <div className="px-4 py-2 bg-red-50 dark:bg-red-900/10 border-b border-slate-100 dark:border-slate-800">
                  <p className="text-xs text-red-600 dark:text-red-400"><span className="font-bold">سبب الرفض:</span> {p.adminNotes}</p>
                </div>
              )}

              {/* Actions */}
              {p.status === "pending" && (
                <div className="px-4 py-3 flex gap-2">
                  <button
                    onClick={() => handleApprove(p.id)}
                    disabled={actionId === p.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {actionId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    قبول
                  </button>
                  <button
                    onClick={() => { setRejectTarget(p.id); setRejectReason(""); }}
                    disabled={actionId === p.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    رفض
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Reject reason modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setRejectTarget(null)}>
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-500" />
              <h3 className="font-black text-slate-800 dark:text-white">رفض الوصل</h3>
            </div>
            <p className="text-sm text-slate-500">يمكنك إضافة سبب الرفض ليُرسَل للسائق (اختياري).</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="سبب الرفض (اختياري)..."
              rows={3}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-red-400/40 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white"
            />
            <div className="flex gap-2">
              <button
                onClick={handleReject}
                disabled={!!actionId}
                className="flex-1 py-3 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {actionId ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد الرفض"}
              </button>
              <button
                onClick={() => setRejectTarget(null)}
                className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-200 transition-colors"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt full-screen preview */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="وصل الدفع"
            className="max-w-full max-h-full rounded-2xl shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ── Admin Key Gate ────────────────────────────────────────────────────────────

function AdminKeyGate({ onKey }: { onKey: (key: string) => void }) {
  const [input, setInput]   = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = input.trim();
    if (!key) { setError("يرجى إدخال المفتاح"); return; }
    setLoading(true);
    setError("");
    try {
      await adminFetch("/api/admin/support/threads", key);
      sessionStorage.setItem(ADMIN_KEY_SS, key);
      onKey(key);
    } catch {
      setError("مفتاح غير صحيح أو لم يتم تهيئة ADMIN_API_KEY في الخادم");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-6" dir="rtl">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-700 text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <HeadphonesIcon className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-xl font-black text-slate-800 dark:text-white mb-1">لوحة الدعم الفني</h1>
        <p className="text-sm text-slate-400 mb-6">ميزو — إدارة محادثات الدعم</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="مفتاح الإدارة (ADMIN_API_KEY)"
            autoFocus
            className="w-full border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-primary to-cyan-500 text-white font-bold py-3 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Thread List ───────────────────────────────────────────────────────────────

function ThreadList({
  threads, selectedId, onSelect, loading, onRefresh,
}: {
  threads: ThreadSummary[];
  selectedId: string | null;
  onSelect: (t: ThreadSummary) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  const pending = threads.filter((t) => t.pendingCount > 0);
  const rest    = threads.filter((t) => t.pendingCount === 0);
  const sorted  = [...pending, ...rest];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-primary" />
          <span className="font-bold text-slate-800 dark:text-white text-sm">صندوق الرسائل</span>
          {pending.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {pending.length}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Threads */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <MessageSquare className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-slate-400">لا توجد محادثات بعد</p>
          </div>
        ) : (
          sorted.map((t) => {
            const isSelected = t.userId === selectedId;
            const hasUnread  = t.pendingCount > 0;
            return (
              <button
                key={t.userId ?? "__anon__"}
                onClick={() => onSelect(t)}
                className={`w-full text-right px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors flex items-start gap-3 ${
                  isSelected
                    ? "bg-primary/10 border-l-2 border-l-primary"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  hasUnread ? "bg-red-100 dark:bg-red-900/30" : "bg-slate-100 dark:bg-slate-800"
                }`}>
                  <User className={`w-4 h-4 ${hasUnread ? "text-red-500" : "text-slate-400"}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-bold truncate ${hasUnread ? "text-slate-800 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}>
                      {t.userName}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">{formatTime(t.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {t.senderType === "admin" && <CheckCheck className="w-3 h-3 text-primary shrink-0" />}
                    <p className={`text-xs truncate ${hasUnread ? "text-slate-700 dark:text-slate-200 font-medium" : "text-slate-400"}`}>
                      {t.senderType === "admin" ? "أنت: " : ""}{t.lastMessage}
                    </p>
                    {hasUnread && (
                      <span className="mr-auto bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full shrink-0">
                        {t.pendingCount}
                      </span>
                    )}
                  </div>
                  {t.userType && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full mt-1 inline-block ${
                      t.userType === "سائق"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                    }`}>
                      {t.userType}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Thread View ───────────────────────────────────────────────────────────────

function ThreadView({
  userId, adminKey, onBack,
}: {
  userId: string;
  adminKey: string;
  onBack: () => void;
}) {
  const [detail, setDetail]     = useState<ThreadDetail | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [reply, setReply]       = useState("");
  const [sending, setSending]   = useState(false);
  const [sendError, setSendError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = () => {
    setTimeout(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, 50);
  };

  const fetchThread = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await adminFetch<ThreadDetail>(`/api/admin/support/threads/${userId}`, adminKey);
      setDetail(data);
      scrollToBottom();
    } catch (e: unknown) {
      if (!silent) setError(e instanceof Error ? e.message : "تعذّر تحميل المحادثة");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId, adminKey]);

  // Initial load
  useEffect(() => { fetchThread(); }, [fetchThread]);

  // Poll every 8s for new messages from the user
  useEffect(() => {
    pollRef.current = setInterval(() => { fetchThread(true); }, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchThread]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reply.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError("");
    try {
      const data = await adminFetch<{ message: SupportMessage }>(
        `/api/admin/support/threads/${userId}/reply`,
        adminKey,
        { method: "POST", body: JSON.stringify({ message: trimmed }) }
      );
      setReply("");
      if (data?.message) {
        setDetail((prev) => {
          if (!prev) return prev;
          if (prev.messages.find((m) => m.id === data.message.id)) return prev;
          return { ...prev, messages: [...prev.messages, data.message] };
        });
        scrollToBottom();
      }
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "تعذّر إرسال الرد");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-slate-500">{error}</p>
        <button onClick={() => fetchThread()} className="text-xs text-primary font-bold flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
        </button>
      </div>
    );
  }

  if (!detail) return null;

  const { user, messages } = detail;

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
        <button
          onClick={onBack}
          className="lg:hidden w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl flex items-center justify-center shrink-0">
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{user.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {user.phone && (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Phone className="w-2.5 h-2.5" /> {user.phone}
              </span>
            )}
            {user.userType && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                user.userType === "سائق"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
              }`}>{user.userType}</span>
            )}
            {user.wilaya && (
              <span className="text-[10px] text-slate-400">{user.commune ? `${user.commune}، ` : ""}{user.wilaya}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => fetchThread(true)}
          className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          title="تحديث"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <MessageSquare className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-slate-400">لا توجد رسائل في هذه المحادثة</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isAdmin = msg.senderType === "admin";
            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1 ${isAdmin ? "items-end" : "items-start"}`}
              >
                {!isAdmin && (
                  <span className="text-[10px] text-slate-400 font-medium px-1">{user.name}</span>
                )}
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    isAdmin
                      ? "bg-primary text-white rounded-tl-sm"
                      : msg.status === "pending"
                        ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-slate-800 dark:text-white rounded-tr-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white rounded-tr-sm"
                  }`}
                >
                  {msg.message}
                </div>
                <div className="flex items-center gap-1 px-1">
                  <Clock className="w-2.5 h-2.5 text-slate-300" />
                  <span className="text-[10px] text-slate-400">{formatFull(msg.createdAt)}</span>
                  {!isAdmin && msg.status === "pending" && (
                    <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 px-1 rounded">لم يُرَد بعد</span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply input */}
      <form
        onSubmit={handleSend}
        className="p-4 border-t border-slate-100 dark:border-slate-800 shrink-0"
      >
        {sendError && <p className="text-xs text-red-500 mb-2 text-center">{sendError}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e as any); }
            }}
            placeholder="اكتب ردك على المستخدم..."
            rows={2}
            maxLength={1000}
            className="flex-1 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/40 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400"
            style={{ maxHeight: "100px", overflowY: "auto" }}
          />
          <button
            type="submit"
            disabled={!reply.trim() || sending}
            className="w-11 h-11 rounded-2xl flex items-center justify-center bg-primary text-white shadow-md shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.95] disabled:opacity-40 shrink-0"
          >
            {sending
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Send className="w-5 h-5" />
            }
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main Admin Panel ──────────────────────────────────────────────────────────

function AdminPanel({ adminKey, onLogout }: { adminKey: string; onLogout: () => void }) {
  const [tab, setTab] = useState<"support" | "payments">("support");

  // Support-chat state
  const [threads, setThreads]       = useState<ThreadSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedThread, setSelectedThread] = useState<ThreadSummary | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");

  const loadThreads = useCallback(async (silent = false) => {
    if (!silent) setListLoading(true);
    try {
      const data = await adminFetch<{ threads: ThreadSummary[] }>("/api/admin/support/threads", adminKey);
      setThreads(data.threads ?? []);
    } catch {
      // silent fail on background polls
    } finally {
      if (!silent) setListLoading(false);
    }
  }, [adminKey]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Poll thread list every 15s
  useEffect(() => {
    const id = setInterval(() => loadThreads(true), 15000);
    return () => clearInterval(id);
  }, [loadThreads]);

  const handleSelect = (t: ThreadSummary) => {
    setSelectedThread(t);
    setMobileView("thread");
  };

  const handleBack = () => {
    setMobileView("list");
    loadThreads(true);
  };

  const unreadCount  = threads.filter((t) => t.pendingCount > 0).length;

  return (
    <div className="h-screen bg-slate-50 dark:bg-slate-950 flex flex-col" dir="rtl">
      {/* Top bar */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm">
        <div className="w-8 h-8 bg-gradient-to-br from-primary to-cyan-500 rounded-xl flex items-center justify-center">
          <HeadphonesIcon className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-black text-slate-800 dark:text-white">لوحة الإدارة — ميزو</h1>
          <p className="text-[10px] text-slate-400">
            {threads.length} محادثة ·{" "}
            <span className="text-red-500 font-medium">{unreadCount} تحتاج ردًا</span>
          </p>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-500 transition-colors px-2 py-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <LogOut className="w-3.5 h-3.5" />
          خروج
        </button>
      </header>

      {/* Tab bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex gap-2 shrink-0">
        <button
          onClick={() => setTab("support")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            tab === "support"
              ? "bg-primary text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          الدعم الفني
          {unreadCount > 0 && (
            <span className={`text-[9px] font-black px-1 py-0.5 rounded-full ${tab === "support" ? "bg-white/30 text-white" : "bg-red-500 text-white"}`}>
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("payments")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            tab === "payments"
              ? "bg-primary text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          وصولات الدفع
        </button>
      </div>

      {/* Body */}
      {tab === "payments" ? (
        <div className="flex-1 overflow-hidden">
          <PaymentsPanel adminKey={adminKey} />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Thread list — always visible on desktop, conditional on mobile */}
          <aside
            className={`w-full lg:w-80 xl:w-96 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 ${
              mobileView === "thread" ? "hidden lg:flex" : "flex"
            }`}
          >
            {listLoading ? (
              <div className="flex items-center justify-center flex-1">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : (
              <ThreadList
                threads={threads}
                selectedId={selectedThread?.userId ?? null}
                onSelect={handleSelect}
                loading={listLoading}
                onRefresh={() => loadThreads()}
              />
            )}
          </aside>

          {/* Thread view */}
          <main
            className={`flex-1 bg-white dark:bg-slate-900 flex flex-col overflow-hidden ${
              mobileView === "list" ? "hidden lg:flex" : "flex"
            }`}
          >
            {selectedThread?.userId ? (
              <ThreadView
                key={selectedThread.userId}
                userId={selectedThread.userId}
                adminKey={adminKey}
                onBack={handleBack}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
                <div className="w-16 h-16 bg-primary/10 rounded-3xl flex items-center justify-center">
                  <MessageSquare className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">اختر محادثة</p>
                  <p className="text-xs text-slate-400 mt-1">اختر محادثة من القائمة لعرض الرسائل والرد عليها</p>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

// ── Page Root ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState<string | null>(() =>
    sessionStorage.getItem(ADMIN_KEY_SS)
  );

  const handleKey = (key: string) => setAdminKey(key);

  const handleLogout = () => {
    sessionStorage.removeItem(ADMIN_KEY_SS);
    setAdminKey(null);
  };

  if (!adminKey) {
    return <AdminKeyGate onKey={handleKey} />;
  }

  return <AdminPanel adminKey={adminKey} onLogout={handleLogout} />;
}
