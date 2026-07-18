import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/layout";
import { useTranslation } from "@/lib/i18n";
import {
  useGetActiveOrders,
  getGetActiveOrdersQueryKey,
  useGetOrdersSummary,
  getGetOrdersSummaryQueryKey,
  useUpdateOrderStatus,
  useGetDriverStatus,
  getGetDriverStatusQueryKey,
  useUpdateDriverStatus,
  useAcceptOrder,
  useGetDriverOrders,
  getGetDriverOrdersQueryKey,
  useGetDriverAccount,
  getGetDriverAccountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeOrders } from "@/hooks/use-realtime-orders";
import { OrderNotification } from "@/components/order-notification";
import { useOrderNotificationStore } from "@/stores/order-notifications";
import {
  Package, Truck, CheckCircle2, User, Phone, MapPin,
  Loader2, PlayCircle, PauseCircle, XCircle, Bell, Coffee, Timer,
  CreditCard, Clock, ShieldAlert, CalendarDays, AlertTriangle,
  HeadphonesIcon,
} from "lucide-react";
import { format } from "date-fns";
import type { DriverStatusInputCurrentStatus } from "@workspace/api-client-react";
import { supabase, updateDriverLocation } from "@/lib/supabase";
import { useSupportChatStore } from "@/stores/support-chat";
import { AppealOverlay } from "@/components/appeal-overlay";

// ─────────────────────────────────────────────────────────────────────────────
// Root page
// ─────────────────────────────────────────────────────────────────────────────
export default function DriverDashboard() {
  const { userId, userType } = useAuth();
  const [, setLocation] = useLocation();

  if (!userId) { setLocation("/"); return null; }
  if (userType !== "سائق") { setLocation("/dashboard"); return null; }

  return (
    <Layout>
      <DriverDashboardContent driverId={userId} />
    </Layout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocking overlay — Pending account (awaiting admin approval)
// ─────────────────────────────────────────────────────────────────────────────
function PendingAccountOverlay() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 mx-4 max-w-sm w-full shadow-2xl border border-amber-200 dark:border-amber-700 text-center animate-in zoom-in-95 duration-300" dir="rtl">
        <div className="w-20 h-20 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <ShieldAlert className="w-10 h-10 text-amber-500" />
        </div>
        <h2 className="text-xl font-black text-slate-800 dark:text-white mb-4">حسابك قيد المراجعة</h2>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 text-right">
          <p className="text-slate-700 dark:text-slate-200 text-sm leading-loose font-bold">
            ملاحظة: الوثائق والصور المطلوبة هي مجرد إجراء شكلي وأمني للتحقق من هوية السائق، والتأكد من جِدية الحساب ومنع السائقين الوهميين. حسابك حالياً قيد المراجعة والتدقيق من قِبل إدارة المشروع.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 mt-5 text-amber-600 dark:text-amber-400">
          <Clock className="w-4 h-4 animate-pulse" />
          <span className="text-sm font-medium">يتم التحقق تلقائياً عند القبول</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocking overlay — Account rejected by admin
// Now delegates to the shared AppealOverlay component (also used by
// BannedAccountOverlay in App.tsx).  The appeal form calls /api/appeal
// (the generic endpoint) instead of the old /api/driver/appeal.
// ─────────────────────────────────────────────────────────────────────────────
function RejectedAccountOverlay() {
  return (
    <AppealOverlay
      title="تم رفض طلبك"
      idleDescription="الرجاء التواصل مع الإدارة عبر الصفحات الرسمية"
      icon={<XCircle className="w-8 h-8 text-red-500" />}
      zClass="z-[200]"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocking overlay — Subscription expired
// ─────────────────────────────────────────────────────────────────────────────
function ExpiredSubscriptionOverlay() {
  const [, setLocation] = useLocation();
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 mx-4 max-w-sm w-full shadow-2xl border border-red-200 dark:border-red-700 text-center animate-in zoom-in-95 duration-300" dir="rtl">
        <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
          <CreditCard className="w-10 h-10 text-red-500" />
        </div>
        <h2 className="text-xl font-black text-slate-800 dark:text-white mb-4">انتهت صلاحية اشتراكك</h2>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-4 text-right">
          <p className="text-slate-700 dark:text-slate-200 text-sm leading-loose font-bold">
            يرجى تجديد اشتراكك للمتابعة في استقبال الطلبات.
          </p>
        </div>
        <button
          onClick={() => setLocation("/subscription")}
          className="mt-6 w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-white bg-gradient-to-r from-primary to-cyan-500 shadow-lg shadow-primary/30 hover:opacity-90 transition-all active:scale-[0.98]"
        >
          <CreditCard className="w-5 h-5" />الذهاب لصفحة الدفع
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main content
// ─────────────────────────────────────────────────────────────────────────────
const BREAK_PRESETS = [15, 30, 45, 60];

function DriverDashboardContent({ driverId }: { driverId: string }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: statuses } = useGetDriverStatus({
    query: { queryKey: getGetDriverStatusQueryKey(), refetchInterval: 15000 }
  });

  const { data: account } = useGetDriverAccount(driverId, {
    query: { queryKey: getGetDriverAccountQueryKey(driverId), refetchInterval: 10000 }
  });

  useEffect(() => {
    if (account === undefined) return;
    // Rejected drivers stay on this page — the overlay is the only UI they see.
    if ((account as any).accountStatus === "rejected") return;
    const isLegacy = (account as any).isLegacyDriver === true;
    const hasDocs  = (account as any).documentsUploaded === true;
    if (!isLegacy && !hasDocs) {
      setLocation("/driver-upload-docs");
      return;
    }
    if (account.subscriptionExpiresAt === null) {
      setLocation("/subscription");
    }
  }, [account, setLocation]);

  const myStatusObj = statuses?.find(s => s.driverId === driverId);
  const currentStatus = (myStatusObj?.currentStatus || "مغلق") as DriverStatusInputCurrentStatus;

  // ── Break duration state ──────────────────────────────────────────────────
  const [showBreakModal, setShowBreakModal] = useState(false);
  const [breakDurationMinutes, setBreakDurationMinutes] = useState(30);
  const [customMinutes, setCustomMinutes] = useState("");
  const [activeBreakSeconds, setActiveBreakSeconds] = useState(30 * 60);
  const pendingBreakMutateRef = useRef<
    ((args: { data: { driverId: string; currentStatus: DriverStatusInputCurrentStatus } }, opts: object) => void) | null
  >(null);

  const handleStatusChange = useCallback(
    (status: DriverStatusInputCurrentStatus, mutate: (args: { data: { driverId: string; currentStatus: DriverStatusInputCurrentStatus } }, opts: object) => void) => {
      mutate(
        { data: { driverId, currentStatus: status } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDriverStatusQueryKey() }) }
      );
    },
    [driverId, queryClient]
  );

  const handleBreakRequested = useCallback(
    (mutate: (args: { data: { driverId: string; currentStatus: DriverStatusInputCurrentStatus } }, opts: object) => void) => {
      pendingBreakMutateRef.current = mutate;
      setBreakDurationMinutes(30);
      setCustomMinutes("");
      setShowBreakModal(true);
    },
    []
  );

  const confirmBreak = () => {
    const custom = parseInt(customMinutes, 10);
    const finalMinutes = !isNaN(custom) && custom > 0 ? custom : breakDurationMinutes;
    setActiveBreakSeconds(finalMinutes * 60);
    setShowBreakModal(false);
    if (pendingBreakMutateRef.current) {
      handleStatusChange("استراحة", pendingBreakMutateRef.current);
      pendingBreakMutateRef.current = null;
    }
  };

  const isRejected = (account as any)?.accountStatus === "rejected";
  const isPending  = !isRejected && account?.accountStatus === "pending";
  const isExpired  = account?.subscriptionExpired === true;
  // True only when the real balance is expired but a receipt is pending
  // admin review — this NEVER reflects a real day added to the balance.
  const isGraceActive = !isExpired && (account as any)?.pendingReceiptGraceActive === true;

  const { name, userType } = useAuth();
  const openSupport = useSupportChatStore((s) => s.open);

  return (
    <>
      {isRejected && <RejectedAccountOverlay />}
      {!isRejected && isPending && <PendingAccountOverlay />}
      {!isRejected && !isPending && isExpired && <ExpiredSubscriptionOverlay />}
      {!isRejected && !isPending && isGraceActive && (
        <div className="mx-4 mt-4 glass-panel rounded-2xl p-4 border-2 border-amber-300/60 bg-amber-50/70 dark:bg-amber-900/20 flex items-start gap-3">
          <Timer className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
            وصل اشتراكك قيد المراجعة من الإدارة — يمكنك استقبال الطلبيات مؤقتاً في هذه الأثناء، لكن هذا لا يُحتسب كأيام فعلية من رصيدك. سيُضاف رصيدك الحقيقي فور قبول الوصل.
          </p>
        </div>
      )}

      {/* ── Break duration picker modal ─────────────────────────────────── */}
      {showBreakModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" dir="rtl">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 mx-4 max-w-sm w-full shadow-2xl border border-amber-200 dark:border-amber-700 animate-in zoom-in-95 duration-300">
            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Timer className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className="font-black text-lg text-slate-800 dark:text-white text-center mb-1">مدة الاستراحة</h3>
            <p className="text-sm text-slate-500 text-center mb-5">اختر كم دقيقة تريد الاستراحة</p>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {BREAK_PRESETS.map(m => (
                <button key={m} onClick={() => { setBreakDurationMinutes(m); setCustomMinutes(""); }}
                  className={`py-2.5 rounded-xl font-bold text-sm transition-all ${
                    breakDurationMinutes === m && !customMinutes
                      ? "bg-amber-500 text-white shadow-md shadow-amber-400/30"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-amber-100 dark:hover:bg-amber-900/20"
                  }`}>
                  {m} د
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-5">
              <input
                type="number"
                min="1"
                max="240"
                value={customMinutes}
                onChange={e => setCustomMinutes(e.target.value)}
                placeholder="عدد مخصص..."
                className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400/40 text-center font-bold"
              />
              <span className="text-sm text-slate-500 font-medium">دقيقة</span>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setShowBreakModal(false)}
                className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-sm">
                إلغاء
              </button>
              <button onClick={confirmBreak}
                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm shadow-md shadow-amber-400/30 flex items-center justify-center gap-2">
                <PauseCircle className="w-4 h-4" />بدء الاستراحة
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500">
        <SummaryStats />
        {account?.subscriptionExpiresAt && (
          <SubscriptionCountdown expiresAt={account.subscriptionExpiresAt} />
        )}
        <AttendanceControl
          driverId={driverId}
          currentStatus={currentStatus}
          onStatusChange={handleStatusChange}
          onBreakRequested={handleBreakRequested}
        />

        {currentStatus === "حاضر" && (
          <>
            <MyActiveDeliveries driverId={driverId} />
            <PendingOrdersQueue driverId={driverId} />
          </>
        )}

        {currentStatus === "استراحة" && (
          <BreakView driverId={driverId} onEndBreak={handleStatusChange} breakSeconds={activeBreakSeconds} />
        )}

        {currentStatus === "مغلق" && <ClosedView />}

        {/* ── Feature 5: Customer Service ───────────────────────────────── */}
        <div className="glass-panel rounded-3xl p-5 border border-slate-100 dark:border-slate-800" dir="rtl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-sky-50 dark:bg-sky-900/20 rounded-xl flex items-center justify-center shrink-0">
              <HeadphonesIcon className="w-5 h-5 text-sky-600" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm text-slate-800 dark:text-white">خدمة العملاء</p>
              <p className="text-xs text-slate-400">تواصل مع فريق الدعم مباشرةً</p>
            </div>
            <button
              onClick={() => openSupport()}
              className="px-4 py-2 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-sky-500 to-cyan-500 shadow-sm hover:opacity-90 transition-all active:scale-[0.98]"
            >
              مراسلتنا
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary stats bar
// ─────────────────────────────────────────────────────────────────────────────
function SummaryStats() {
  const { t } = useTranslation();
  const { data: summary } = useGetOrdersSummary({
    query: { queryKey: getGetOrdersSummaryQueryKey(), refetchInterval: 15000 }
  });
  if (!summary) return null;
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="glass-panel p-3 flex flex-col items-center rounded-2xl">
        <span className="text-xs text-slate-500 font-medium">{t("driver.stats.total")}</span>
        <span className="text-xl font-bold text-slate-800 dark:text-white">{summary.total}</span>
      </div>
      <div className="glass-panel p-3 flex flex-col items-center rounded-2xl bg-amber-50/50 dark:bg-amber-900/10">
        <span className="text-xs text-amber-600 font-medium">{t("driver.stats.inDelivery")}</span>
        <span className="text-xl font-bold text-amber-700">{summary.inDelivery}</span>
      </div>
      <div className="glass-panel p-3 flex flex-col items-center rounded-2xl bg-emerald-50/50 dark:bg-emerald-900/10">
        <span className="text-xs text-emerald-600 font-medium">{t("driver.stats.completed")}</span>
        <span className="text-xl font-bold text-emerald-700">{summary.delivered}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription countdown timer (Feature 5)
// ─────────────────────────────────────────────────────────────────────────────
function SubscriptionCountdown({ expiresAt }: { expiresAt: string }) {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const getSecondsLeft = () =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));

  const [secondsLeft, setSecondsLeft] = useState(getSecondsLeft);

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(getSecondsLeft()), 60_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const days    = Math.floor(secondsLeft / 86400);
  const hours   = Math.floor((secondsLeft % 86400) / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const isExpired = secondsLeft === 0;
  const isWarning = !isExpired && secondsLeft < 3 * 24 * 3600;

  const color = isExpired
    ? { border: "border-destructive", bg: "bg-destructive/5", text: "text-destructive", unit: "bg-destructive/10 text-destructive", bar: "bg-destructive" }
    : isWarning
    ? { border: "border-amber-400", bg: "bg-amber-50/30 dark:bg-amber-900/10", text: "text-amber-700 dark:text-amber-300", unit: "bg-amber-100 dark:bg-amber-900/30 text-amber-600", bar: "bg-amber-400" }
    : { border: "border-primary/20", bg: "bg-primary/5", text: "text-primary", unit: "bg-primary/10 text-primary", bar: "bg-primary" };

  return (
    <div
      className={`glass-panel rounded-3xl p-4 border-2 transition-all ${color.border} ${color.bg}`}
      dir="rtl"
    >
      {/* Label row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${color.unit}`}>
            {isExpired ? <AlertTriangle className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
          </div>
          <p className={`text-xs font-bold ${color.text}`}>
            {isExpired ? t("driver.subscription.expired") : isWarning ? t("driver.subscription.warning") : t("driver.subscription.active")}
          </p>
        </div>
        <button
          onClick={() => setLocation("/subscription")}
          className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${
            isExpired || isWarning
              ? "bg-destructive text-white hover:bg-destructive/80"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          {isExpired || isWarning ? t("driver.subscription.renew") : t("driver.subscription.view")}
        </button>
      </div>

      {/* Days / Hours / Minutes boxes */}
      {!isExpired && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { value: days,    label: "أيام" },
            { value: hours,   label: "ساعات" },
            { value: minutes, label: "دقائق" },
          ].map(({ value, label }) => (
            <div key={label} className={`rounded-2xl py-2 px-1 text-center ${color.unit}`}>
              <p className="text-2xl font-black tabular-nums leading-none">{String(value).padStart(2, "0")}</p>
              <p className="text-[10px] font-bold mt-0.5 opacity-80">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      {!isExpired && (
        <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${color.bar}`}
            style={{ width: `${Math.min(100, (secondsLeft / (30 * 24 * 3600)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attendance pill slider
// ─────────────────────────────────────────────────────────────────────────────
function AttendanceControl({
  driverId, currentStatus, onStatusChange, onBreakRequested,
}: {
  driverId: string;
  currentStatus: DriverStatusInputCurrentStatus;
  onStatusChange: (
    status: DriverStatusInputCurrentStatus,
    mutate: (args: { data: { driverId: string; currentStatus: DriverStatusInputCurrentStatus } }, opts: object) => void
  ) => void;
  onBreakRequested?: (
    mutate: (args: { data: { driverId: string; currentStatus: DriverStatusInputCurrentStatus } }, opts: object) => void
  ) => void;
}) {
  const updateStatusMutation = useUpdateDriverStatus();

  const getStatusOffset = () => {
    switch (currentStatus) {
      case "حاضر":    return "translate-x-0";
      case "استراحة": return "-translate-x-full";
      case "مغلق":    return "-translate-x-[200%]";
      default:         return "-translate-x-[200%]";
    }
  };

  const getStatusColor = () => {
    switch (currentStatus) {
      case "حاضر":    return "bg-emerald-500 shadow-emerald-500/40";
      case "استراحة": return "bg-amber-500 shadow-amber-500/40";
      case "مغلق":    return "bg-destructive shadow-destructive/40";
      default:         return "bg-destructive";
    }
  };

  const change = (s: DriverStatusInputCurrentStatus) => {
    if (s === currentStatus) return;
    if (s === "استراحة" && onBreakRequested) {
      onBreakRequested(updateStatusMutation.mutate);
      return;
    }
    onStatusChange(s, updateStatusMutation.mutate);
  };

  const { t } = useTranslation();

  return (
    <div className="glass-panel p-5 rounded-3xl">
      <h3 className="font-bold text-slate-800 dark:text-white mb-4 text-center">{t("driver.attendance")}</h3>
      <div className="relative bg-slate-100 dark:bg-slate-800/80 p-1.5 rounded-full flex h-14" dir="rtl">
        <div className={`absolute top-1.5 bottom-1.5 w-[calc(33.333%-4px)] rounded-full transition-all duration-300 shadow-lg ${getStatusColor()} ${getStatusOffset()}`} />
        <button onClick={() => change("حاضر")}
          className={`flex-1 relative z-10 flex items-center justify-center gap-1.5 font-bold text-sm transition-colors duration-300 ${currentStatus === "حاضر" ? "text-white" : "text-slate-500"}`}
          data-testid="status-active"><PlayCircle className="w-4 h-4" /> {t("driver.status.active")}</button>
        <button onClick={() => change("استراحة")}
          className={`flex-1 relative z-10 flex items-center justify-center gap-1.5 font-bold text-sm transition-colors duration-300 ${currentStatus === "استراحة" ? "text-white" : "text-slate-500"}`}
          data-testid="status-break"><PauseCircle className="w-4 h-4" /> {t("driver.status.break")}</button>
        <button onClick={() => change("مغلق")}
          className={`flex-1 relative z-10 flex items-center justify-center gap-1.5 font-bold text-sm transition-colors duration-300 ${currentStatus === "مغلق" ? "text-white" : "text-slate-500"}`}
          data-testid="status-closed"><XCircle className="w-4 h-4" /> {t("driver.status.closed")}</button>
      </div>
      {updateStatusMutation.isPending && (
        <div className="text-center mt-2"><Loader2 className="w-4 h-4 animate-spin text-primary inline-block" /></div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Break view
// ─────────────────────────────────────────────────────────────────────────────
function BreakView({
  driverId, onEndBreak, breakSeconds,
}: {
  driverId: string;
  breakSeconds: number;
  onEndBreak: (
    status: DriverStatusInputCurrentStatus,
    mutate: (args: { data: { driverId: string; currentStatus: DriverStatusInputCurrentStatus } }, opts: object) => void
  ) => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(breakSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updateStatusMutation = useUpdateDriverStatus();

  useEffect(() => {
    setSecondsLeft(breakSeconds);
    intervalRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) { clearInterval(intervalRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [breakSeconds]);

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  const progress = breakSeconds > 0 ? ((breakSeconds - secondsLeft) / breakSeconds) * 100 : 100;
  const isExpired = secondsLeft === 0;

  const handleEndBreak = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    onEndBreak("حاضر", updateStatusMutation.mutate);
  };

  return (
    <div className="glass-panel rounded-3xl p-8 flex flex-col items-center gap-6 animate-in fade-in duration-400">
      <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg ${isExpired ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
        {isExpired ? <Coffee className="w-10 h-10 text-emerald-500" /> : <Timer className="w-10 h-10 text-amber-500" />}
      </div>
      <div className="relative flex items-center justify-center w-40 h-40">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="70" fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-200 dark:text-slate-700" />
          <circle cx="80" cy="80" r="70" fill="none" stroke="currentColor" strokeWidth="8"
            strokeDasharray={`${2 * Math.PI * 70}`}
            strokeDashoffset={`${2 * Math.PI * 70 * (1 - progress / 100)}`}
            strokeLinecap="round"
            className={`transition-all duration-1000 ${isExpired ? "text-emerald-500" : "text-amber-500"}`} />
        </svg>
        <div className="text-center z-10">
          <div className={`text-4xl font-black tabular-nums tracking-tight ${isExpired ? "text-emerald-600" : "text-amber-600"}`}>
            {minutes}:{seconds}
          </div>
          <div className="text-xs text-slate-400 font-medium mt-1">{isExpired ? "انتهت الاستراحة" : "استراحة"}</div>
        </div>
      </div>
      <p className="text-slate-600 dark:text-slate-300 text-center text-sm leading-relaxed max-w-xs">
        {isExpired ? "انتهت مدة استراحتك. أنت جاهز للعودة واستقبال الطلبات." : "أنت في وضع الاستراحة. لن تظهر لك طلبات جديدة خلال هذه الفترة."}
      </p>
      <button onClick={handleEndBreak} disabled={updateStatusMutation.isPending}
        className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
          isExpired ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-400/30 animate-pulse" : "bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-400/30"
        }`} data-testid="button-end-break">
        {updateStatusMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlayCircle className="w-5 h-5" />}
        إنهاء الاستراحة والعودة للعمل
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Closed view
// ─────────────────────────────────────────────────────────────────────────────
function ClosedView() {
  return (
    <div className="glass-panel rounded-3xl p-10 flex flex-col items-center gap-5 text-center animate-in fade-in duration-400">
      <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center shadow-inner">
        <XCircle className="w-10 h-10 text-destructive" />
      </div>
      <h3 className="text-xl font-black text-slate-800 dark:text-white">الحساب مغلق</h3>
      <p className="text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs">
        حسابك مغلق حالياً. يرجى تفعيل وضع الحضور لاستقبال طلبات المياه 💧
      </p>
      <div className="flex gap-2 mt-2">
        {[..."💧💧💧"].map((d, i) => (
          <span key={i} className="text-2xl animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}>{d}</span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// My in-progress deliveries
// ─────────────────────────────────────────────────────────────────────────────
function MyActiveDeliveries({ driverId }: { driverId: string }) {
  const queryClient = useQueryClient();
  const { data: orders, isLoading } = useGetDriverOrders(driverId, {
    query: { queryKey: getGetDriverOrdersQueryKey(driverId), refetchInterval: 8000 }
  });
  const updateStatusMutation = useUpdateOrderStatus();

  if (isLoading || !orders || orders.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="font-bold text-lg text-primary px-2 flex items-center gap-2">
        <Truck className="w-5 h-5" />توصيلاتي النشطة
      </h2>
      {orders.map(order => (
        <div key={order.id} className="glass-panel p-5 rounded-3xl border-2 border-primary/30 relative overflow-hidden" data-testid={`my-delivery-${order.id}`}>
          <div className="absolute top-0 right-0 w-1.5 h-full bg-primary" />

          <div className="flex justify-between items-start mb-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <span className="font-bold text-lg text-primary">{order.waterVolume}</span>
              <div className="text-sm text-slate-500">{order.barrelCount} براميل</div>
            </div>
            <div className="text-xl font-black text-slate-800 dark:text-white">
              {order.totalPrice} <span className="text-sm font-normal">دج</span>
            </div>
          </div>

          <div className="space-y-2 mb-4 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2"><User className="w-4 h-4 text-slate-400" /><span>{order.userName || "عميل"}</span></div>
            {order.userPhone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" />
                <a href={`tel:${order.userPhone}`} className="text-primary font-bold hover:underline">{order.userPhone}</a>
              </div>
            )}
            {order.latitude && order.longitude && (
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-400">{Number(order.latitude).toFixed(5)}, {Number(order.longitude).toFixed(5)}</span>
              </div>
            )}
          </div>

          {/* [تعديل 3]: خريطة الأقمار الصناعية الحية مع تحديث مستمر لموقع السائق */}
          {order.latitude && order.longitude && (
            <SatelliteMap
              orderId={order.id}
              driverId={driverId}
              destLat={Number(order.latitude)}
              destLng={Number(order.longitude)}
              orderStatus={order.status}
            />
          )}

          <div className="space-y-3 mt-4">
            {order.status === "قيد التوصيل" && (
              <button
                onClick={() => updateStatusMutation.mutate(
                  { orderId: order.id, data: { status: "وصل السائق" } },
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({ queryKey: getGetDriverOrdersQueryKey(driverId) });
                      queryClient.invalidateQueries({ queryKey: getGetOrdersSummaryQueryKey() });
                    }
                  }
                )}
                disabled={updateStatusMutation.isPending}
                className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold bg-amber-400 hover:bg-amber-500 text-white shadow-md shadow-amber-400/30 animate-pulse transition-all active:scale-[0.98]"
                data-testid={`button-arrived-${order.id}`}
              >
                <Bell className="w-5 h-5" />لقد وصلت إلى منزل العميل
              </button>
            )}
            {(order.status === "وصل السائق" || order.status === "قيد التوصيل") && (
              <button
                onClick={() => updateStatusMutation.mutate(
                  { orderId: order.id, data: { status: "تم التوصيل" } },
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({ queryKey: getGetDriverOrdersQueryKey(driverId) });
                      queryClient.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
                      queryClient.invalidateQueries({ queryKey: getGetOrdersSummaryQueryKey() });
                    }
                  }
                )}
                disabled={updateStatusMutation.isPending}
                className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/20 transition-all active:scale-[0.98]"
                data-testid={`button-complete-${order.id}`}
              >
                <CheckCircle2 className="w-5 h-5" />تأكيد التسليم
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [تعديل 3]: خريطة الأقمار الصناعية الحية — Live Satellite GPS Map
//
// • تعرض صور الأقمار الصناعية (Esri World Imagery — مجانية بدون API Key)
// • تستخدم navigator.geolocation.watchPosition للتحديث الحي المستمر
// • مؤشر السائق يتحرك تلقائياً مع تغيّر موقعه الفعلي
// • ترسل الإحداثيات إلى Supabase كل 5 ثوانٍ — فقط عندما تكون الحالة "قيد التوصيل"
// ─────────────────────────────────────────────────────────────────────────────
function SatelliteMap({
  orderId, driverId, destLat, destLng, orderStatus,
}: {
  orderId: string;
  driverId: string;
  destLat: number;
  destLng: number;
  /** Only broadcasts location to Supabase while this equals "قيد التوصيل". */
  orderStatus: string;
}) {
  const mapRef         = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const driverMarkerRef = useRef<unknown>(null);
  const polylineRef    = useRef<unknown>(null);
  const watchIdRef     = useRef<number | null>(null);
  const lastSupabaseUpdate = useRef<number>(0);
  const [driverPos, setDriverPos] = useState<[number, number] | null>(null);

  // Use a ref so the watchPosition callback always reads the *current* status
  // without needing to re-mount the map when the order moves from
  // "قيد التوصيل" → "وصل السائق".
  const orderStatusRef = useRef(orderStatus);
  useEffect(() => { orderStatusRef.current = orderStatus; }, [orderStatus]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Load Leaflet CSS once
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement("link");
      link.rel  = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const win = window as unknown as Record<string, unknown>;

    const initMap = () => {
      if (!mapRef.current || mapInstanceRef.current) return;

      type LeafletType = {
        map: (el: HTMLElement, opts: object) => {
          setView: (c: [number, number], z: number) => void;
          fitBounds: (b: [[number, number], [number, number]], opts: object) => void;
          remove: () => void;
        };
        tileLayer: (url: string, opts: object) => { addTo: (m: unknown) => unknown };
        marker: (c: [number, number], opts?: object) => {
          addTo: (m: unknown) => { bindPopup: (s: string) => unknown };
          setLatLng: (c: [number, number]) => void;
          bindPopup: (s: string) => unknown;
        };
        divIcon: (opts: object) => object;
        latLngBounds: (corners: [[number, number], [number, number]]) => unknown;
        polyline: (latlngs: [number, number][], opts?: object) => {
          addTo: (m: unknown) => unknown;
          setLatLngs: (latlngs: [number, number][]) => void;
        };
      };

      const L = win["L"] as LeafletType;

      // Initialize map
      const map = L.map(mapRef.current!, {
        zoomControl: true,
        attributionControl: false,
      });
      mapInstanceRef.current = map;

      // Center on destination initially
      map.setView([destLat, destLng], 15);

      // ── Satellite tile layer (Esri World Imagery — مجانية بدون API Key) ──
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution: "© Esri, Maxar, Earthstar Geographics",
        }
      ).addTo(map);

      // Destination marker (red pin)
      const destIcon = L.divIcon({
        html: `<div style="
          width:18px;height:18px;border-radius:50%;
          background:#ef4444;border:3px solid white;
          box-shadow:0 2px 10px rgba(0,0,0,0.5)"></div>`,
        className: "",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([destLat, destLng], { icon: destIcon })
        .addTo(map)
        .bindPopup("📍 موقع العميل");

      // Driver icon (blue pulsing dot)
      const driverIcon = L.divIcon({
        html: `<div style="position:relative;width:24px;height:24px">
          <div style="
            position:absolute;inset:0;border-radius:50%;
            background:#0ea5e9;opacity:0.3;
            animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite"></div>
          <div style="
            position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            width:14px;height:14px;border-radius:50%;
            background:#0ea5e9;border:2px solid white;
            box-shadow:0 2px 8px rgba(14,165,233,0.7)"></div>
        </div>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      // Inject ping animation keyframes once
      if (!document.getElementById("driver-ping-style")) {
        const style = document.createElement("style");
        style.id = "driver-ping-style";
        style.textContent = `@keyframes ping{75%,100%{transform:scale(2.5);opacity:0}}`;
        document.head.appendChild(style);
      }

      // ── watchPosition — تحديث حي ومستمر لموقع السائق ──
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const latLng: [number, number] = [latitude, longitude];

          setDriverPos(latLng);

          if (!driverMarkerRef.current) {
            // أول موقع — إنشاء المؤشر والخط وضبط حدود الخريطة
            driverMarkerRef.current = L.marker(latLng, { icon: driverIcon })
              .addTo(map)
              .bindPopup("🚚 موقعي الحالي");

            polylineRef.current = L.polyline([latLng, [destLat, destLng]], {
              color: "#0ea5e9",
              weight: 4,
              opacity: 0.85,
              dashArray: "10, 6",
            }).addTo(map);

            map.fitBounds(
              [[latitude, longitude], [destLat, destLng]],
              { padding: [50, 50] }
            );
          } else {
            // تحديث موقع المؤشر والخط بدون إعادة تحميل الصفحة
            (driverMarkerRef.current as { setLatLng: (c: [number, number]) => void })
              .setLatLng(latLng);
            if (polylineRef.current) {
              (polylineRef.current as { setLatLngs: (c: [number, number][]) => void })
                .setLatLngs([latLng, [destLat, destLng]]);
            }
          }

          // إرسال الإحداثيات إلى Supabase كل 5 ثوانٍ — فقط أثناء التوصيل الفعلي.
          // نتوقف عن الإرسال حين تصبح الحالة "وصل السائق" أو "تم التوصيل"
          // حتى لا نُبقي موقع السائق مكشوفاً أطول من اللازم.
          const now = Date.now();
          if (
            orderStatusRef.current === "قيد التوصيل" &&
            now - lastSupabaseUpdate.current > 5000
          ) {
            lastSupabaseUpdate.current = now;
            updateDriverLocation(driverId, latitude, longitude);
          }
        },
        (err) => {
          // GPS unavailable — show destination only, no crash
          console.warn("[GPS] watchPosition error:", err.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 2000,   // قبول موقع لا يزيد عمره عن 2 ثانية
        }
      );
    };

    const loadLeaflet = async () => {
      if (!win["L"]) {
        await new Promise<void>(resolve => {
          const s = document.createElement("script");
          s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          s.onload = () => resolve();
          document.head.appendChild(s);
        });
      }
      initMap();
    };

    loadLeaflet();

    return () => {
      // تنظيف: إيقاف المراقبة وإزالة الخريطة
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
      driverMarkerRef.current = null;
      polylineRef.current = null;
    };
  }, [orderId, destLat, destLng, driverId]);

  return (
    <div className="space-y-2">
      <div
        ref={mapRef}
        className="w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700"
        style={{ height: "240px" }}
        data-testid={`map-${orderId}`}
      />
      {driverPos && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&origin=${driverPos[0]},${driverPos[1]}&destination=${destLat},${destLng}&travelmode=driving`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-sm"
        >
          <MapPin className="w-4 h-4" />
          التنقل عبر خرائط Google
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue of pending orders
// ─────────────────────────────────────────────────────────────────────────────
const MAX_ACTIVE_ORDERS = 2;

function PendingOrdersQueue({ driverId }: { driverId: string }) {
  const queryClient = useQueryClient();

  // Available orders for this driver's commune
  const { data: orders, isLoading } = useGetActiveOrders(
    { driverId },
    { query: { queryKey: getGetActiveOrdersQueryKey({ driverId }), refetchInterval: 6000 } }
  );

  // Driver's own active deliveries — used to enforce the 2-order cap
  const { data: myOrders } = useGetDriverOrders(driverId, {
    query: { queryKey: getGetDriverOrdersQueryKey(driverId) }
  });

  // Count orders that are still in progress (قيد التوصيل or وصل السائق)
  const activeDeliveryCount = (myOrders ?? []).filter(
    o => o.status === "قيد التوصيل" || o.status === "وصل السائق"
  ).length;
  const atLimit = activeDeliveryCount >= MAX_ACTIVE_ORDERS;

  const acceptMutation = useAcceptOrder();

  // ── Realtime push notifications (existing) ───────────────────────────────
  const { notification, dismiss } = useRealtimeOrders(driverId, orders?.length ?? 0);
  const resetNavBadge = useOrderNotificationStore((s) => s.reset);
  useEffect(() => { resetNavBadge(); }, []);
  const handleDismiss = () => { dismiss(); resetNavBadge(); };

  // ── Rule 4: Supabase postgres_changes → live counter ────────────────────
  // Subscribes to any INSERT/UPDATE/DELETE on the orders table so the
  // available-orders badge updates immediately without a page refresh.
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`orders:live-counter:${driverId}`)
        .on(
          "postgres_changes" as Parameters<ReturnType<typeof supabase.channel>["on"]>[0],
          { event: "*", schema: "public", table: "orders" },
          () => {
            queryClient.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey({ driverId }) });
            queryClient.invalidateQueries({ queryKey: getGetDriverOrdersQueryKey(driverId) });
          }
        )
        .subscribe((status: string, err?: unknown) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[Realtime] orders live-counter error (non-fatal):", err ?? status);
          }
        });
    } catch (err) {
      console.warn("[Realtime] orders live-counter init failed (non-fatal):", err);
    }
    return () => {
      if (channel) { try { supabase.removeChannel(channel); } catch { /* ignore */ } }
    };
  }, [driverId, queryClient]);

  const handleAccept = (orderId: string) => {
    if (atLimit) return;
    acceptMutation.mutate(
      { orderId, data: { driverId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDriverOrdersQueryKey(driverId) });
          queryClient.invalidateQueries({ queryKey: getGetOrdersSummaryQueryKey() });
        },
        onError: () => {
          queryClient.invalidateQueries({ queryKey: getGetActiveOrdersQueryKey() });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <>
      <OrderNotification show={notification} onDismiss={handleDismiss} />

      <div className="space-y-4">
        <h2 className="font-bold text-lg text-slate-800 dark:text-white px-2 flex items-center gap-2">
          <Package className="w-5 h-5" />الطلبات المتاحة
          {orders && orders.length > 0 && (
            <span className="bg-primary text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0">{orders.length}</span>
          )}
        </h2>

        {/* Rule 1 — limit banner */}
        {atLimit && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-4 flex items-center gap-3" dir="rtl">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm font-bold text-red-700 dark:text-red-400">
              لا يمكنك قبول طلبات جديدة، لديك طلبين قيد التوصيل
            </p>
          </div>
        )}

        {!orders || orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 glass-panel rounded-3xl">
            <Package className="w-14 h-14 mb-4 opacity-40" />
            <p className="text-base">لا توجد طلبات معلقة حالياً</p>
          </div>
        ) : (
          orders.map(order => (
            <div key={order.id} className="glass-panel p-5 rounded-3xl overflow-hidden relative" data-testid={`pending-order-${order.id}`}>
              <div className="absolute top-0 right-0 w-1 h-full bg-sky-400" />

              <div className="flex justify-between items-start mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <span className="font-bold text-lg text-primary">{order.waterVolume}</span>
                  <div className="text-sm text-slate-500">{order.barrelCount} براميل</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-black text-slate-800 dark:text-white">
                    {order.totalPrice} <span className="text-sm font-normal">دج</span>
                  </div>
                  <div className="text-xs text-slate-400">{format(new Date(order.createdAt), "HH:mm")}</div>
                </div>
              </div>

              <div className="space-y-2 mb-5 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-2"><User className="w-4 h-4 text-slate-400" /><span>{order.userName || "عميل"}</span></div>
                {order.userPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-slate-400" />
                    <a href={`tel:${order.userPhone}`} className="text-primary font-bold hover:underline">{order.userPhone}</a>
                  </div>
                )}
                {order.latitude && order.longitude && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 text-xs">تم تحديد موقع العميل بدقة</span>
                  </div>
                )}
              </div>

              {/* Rule 1 — disable button when at limit */}
              <button
                onClick={() => handleAccept(order.id)}
                disabled={acceptMutation.isPending || atLimit}
                className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold bg-gradient-to-r from-primary to-cyan-500 text-white shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid={`button-accept-${order.id}`}
              >
                {acceptMutation.isPending
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <><Truck className="w-5 h-5" /> قبول وتوصيل الطلب</>}
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
