import { useState, useRef, useCallback, useEffect } from "react";
import { compressImage } from "@/lib/compress-image";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/layout";
import { useTranslation } from "@/lib/i18n";
import {
  useGetDriverSubscription,
  getGetDriverSubscriptionQueryKey,
  useSubmitSubscriptionReceipt,
  useGetDriverAccount,
  getGetDriverAccountQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Upload,
  CheckCircle2,
  Clock,
  XCircle,
  ImageIcon,
  ArrowRight,
  Loader2,
  AlertCircle,
  Banknote,
  Phone,
  Gift,
  CalendarDays,
} from "lucide-react";

export default function SubscriptionPage() {
  const { userId, userType } = useAuth();
  const [, setLocation] = useLocation();

  if (!userId) { setLocation("/"); return null; }
  if (userType !== "سائق") { setLocation("/dashboard"); return null; }

  return (
    <Layout>
      <SubscriptionContent driverId={userId} />
    </Layout>
  );
}

function SubscriptionContent({ driverId }: { driverId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: account } = useGetDriverAccount(driverId, {
    query: { queryKey: getGetDriverAccountQueryKey(driverId), retry: false, refetchInterval: 5_000 },
  });

  const neverSubscribed = account !== undefined && account.subscriptionExpiresAt === null;

  useEffect(() => {
    if (!neverSubscribed) return;
    window.history.pushState(null, "", window.location.href);
    const handlePop = () => window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, [neverSubscribed]);

  const { data: payment, isLoading } = useGetDriverSubscription(driverId, {
    query: {
      queryKey: getGetDriverSubscriptionQueryKey(driverId),
      refetchInterval: 15000,
      retry: false,
    },
  });

  const submitMutation = useSubmitSubscriptionReceipt();

  // Free trial state
  const freeTrialClaimed = (account as Record<string, unknown> | undefined)?.freeTrialClaimed === true;
  const [freeTrialLoading, setFreeTrialLoading] = useState(false);
  const [freeTrialError, setFreeTrialError] = useState<string | null>(null);

  const handleClaimFreeTrial = async () => {
    setFreeTrialLoading(true);
    setFreeTrialError(null);
    try {
      await customFetch(`/api/driver/${driverId}/free-trial`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: getGetDriverAccountQueryKey(driverId) });
      setLocation("/driver-dashboard");
    } catch (err: any) {
      setFreeTrialError(err?.data?.error ?? "حدث خطأ. حاول مجدداً.");
    } finally {
      setFreeTrialLoading(false);
    }
  };

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSubmit = () => {
    if (!imagePreview) return;
    submitMutation.mutate(
      { driverId, data: { receiptImage: imagePreview, months: 1 } },
      {
        onSuccess: () => {
          setImagePreview(null);
          queryClient.invalidateQueries({
            queryKey: getGetDriverSubscriptionQueryKey(driverId),
          });
          queryClient.invalidateQueries({
            queryKey: getGetDriverAccountQueryKey(driverId),
          });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-slate-500 text-sm">جارٍ التحميل...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3">
        {!neverSubscribed && (
          <button
            onClick={() => setLocation("/driver-dashboard")}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            <ArrowRight className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>
        )}
        <div>
          <h1 className="text-xl font-black text-slate-800 dark:text-white">{t("subscription.title")}</h1>
          <p className="text-sm text-slate-500">{t("subscription.subtitle")}</p>
        </div>
      </div>

      {/* Current status — sourced directly from the database (account.subscriptionExpiresAt), never from local form state */}
      {!neverSubscribed && account && (
        <CurrentSubscriptionStatus expiresAt={account.subscriptionExpiresAt} />
      )}

      {/* Free Trial card — only for first-time drivers */}
      {neverSubscribed && (
        <div className="glass-panel rounded-3xl p-6 border-2 border-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/10 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center text-emerald-600">
              <Gift className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-white">تجربة مجانية لـ 30 يوماً</h2>
              <p className="text-sm text-slate-500">مرة واحدة فقط لكل سائق</p>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300 leading-loose">
            بما أنك تنضم إلينا لأول مرة، يمكنك تفعيل <strong>30 يوماً مجاناً</strong> بضغطة زر واحدة. تُمكّنك هذه الفترة من استقبال الطلبات دون أي رسوم.
          </p>

          {freeTrialError && (
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-3">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{freeTrialError}</p>
            </div>
          )}

          <button
            onClick={handleClaimFreeTrial}
            disabled={freeTrialLoading || freeTrialClaimed}
            className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {freeTrialLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                جارٍ التفعيل...
              </>
            ) : freeTrialClaimed ? (
              <>
                <CheckCircle2 className="w-5 h-5" />
                تم استخدام التجربة المجانية
              </>
            ) : (
              <>
                <Gift className="w-5 h-5" />
                الحصول على التجربة المجانية
              </>
            )}
          </button>
        </div>
      )}

      {/* Subscription info card */}
      <div className="glass-panel rounded-3xl p-6 border border-primary/20">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
            <Banknote className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800 dark:text-white">تفاصيل الاشتراك</h2>
            <p className="text-sm text-slate-500">اشتراك شهري لاستقبال طلبات المياه</p>
          </div>
        </div>
        <div className="bg-primary/5 rounded-2xl p-4 space-y-2 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-slate-600 dark:text-slate-400">قيمة الاشتراك</span>
            <span className="font-black text-primary text-lg">1000 دج</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-600 dark:text-slate-400">المدة</span>
            <span className="font-bold text-slate-800 dark:text-white">30 يوماً</span>
          </div>
          <div className="border-t border-primary/10 pt-2 mt-2">
            <p className="text-slate-500 text-xs leading-loose">
              يُمكّنك الاشتراك من استقبال طلبات التوصيل طوال الشهر. بعد انتهاء المدة يُوقف الحساب تلقائياً حتى تجديد الاشتراك.
            </p>
          </div>
        </div>

        {/* Payment method */}
        <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-4 space-y-3">
          <p className="font-bold text-amber-800 dark:text-amber-300 text-sm flex items-center gap-2">
            <Phone className="w-4 h-4" />
            طريقة الدفع
          </p>
          <p className="text-slate-700 dark:text-slate-200 text-sm leading-loose">
            قم بتحويل مبلغ <strong>1000 دج</strong> عبر البريد الجزائري (CCP) إلى الحساب التالي:
          </p>
          <div className="bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-600 rounded-xl p-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">رقم الحساب البريدي (CCP)</p>
              <p className="font-black text-slate-800 dark:text-white text-lg tracking-widest dir-ltr text-left">004129412426</p>
            </div>
            <Banknote className="w-8 h-8 text-amber-500 shrink-0" />
          </div>
          <p className="text-xs text-slate-500">بعد التحويل، ارفع صورة الوصل أدناه لتفعيل اشتراكك.</p>
        </div>
      </div>

      {/* Latest payment status */}
      {payment && <PaymentStatusCard payment={payment} />}

      {/* Upload form — hide if payment pending review */}
      {payment?.status === "pending" ? (
        <div className="glass-panel rounded-3xl p-6 text-center border border-amber-200 dark:border-amber-700 space-y-3">
          <Clock className="w-10 h-10 text-amber-500 mx-auto" />
          <h3 className="font-bold text-slate-800 dark:text-white">في انتظار تأكيد اشتراكك</h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            تم استلام وصلك وهو الآن تحت مراجعة الإدارة. سيتم تفعيل اشتراكك فور القبول.
          </p>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-2xl p-3 flex items-start gap-2 text-right">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
              مكافأة: تم منحك <strong>3 أيام مجانية</strong> فور رفع الوصل. يمكنك استقبال الطلبات الآن بينما يُراجع الإداريون وصلك.
            </p>
          </div>
        </div>
      ) : (
        <UploadReceiptForm
          imagePreview={imagePreview}
          dragOver={dragOver}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onChooseFile={() => fileInputRef.current?.click()}
          onClear={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
          onSubmit={handleSubmit}
          isSubmitting={submitMutation.isPending}
          error={submitMutation.error?.message ?? null}
        />
      )}
    </div>
  );
}

// ─── Latest payment status card ───────────────────────────────────────────────
function PaymentStatusCard({ payment }: { payment: { status: string; adminNotes?: string | null; createdAt: string } }) {
  const statusConfig = {
    pending: {
      icon: <Clock className="w-6 h-6 text-amber-500" />,
      bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700",
      label: "قيد المراجعة",
      labelColor: "text-amber-700 dark:text-amber-300",
      desc: "تم استلام وصلك ويجري فحصه من قِبل الإدارة.",
    },
    approved: {
      icon: <CheckCircle2 className="w-6 h-6 text-emerald-500" />,
      bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700",
      label: "تم القبول ✓",
      labelColor: "text-emerald-700 dark:text-emerald-300",
      desc: "تم قبول وصلك وتجديد اشتراكك بنجاح.",
    },
    rejected: {
      icon: <XCircle className="w-6 h-6 text-red-500" />,
      bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700",
      label: "مرفوض",
      labelColor: "text-red-700 dark:text-red-300",
      desc: "تم رفض وصلك. يرجى رفع وصل صحيح.",
    },
  } as const;

  const s = payment.status as keyof typeof statusConfig;
  const cfg = statusConfig[s] ?? statusConfig.pending;
  const date = new Date(payment.createdAt).toLocaleDateString("ar-DZ", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className={`rounded-3xl p-5 border ${cfg.bg} animate-in fade-in duration-300`}>
      <div className="flex items-center gap-3 mb-2">
        {cfg.icon}
        <div>
          <span className={`font-bold text-sm ${cfg.labelColor}`}>{cfg.label}</span>
          <p className="text-xs text-slate-500">{date}</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{cfg.desc}</p>
      {payment.adminNotes && (
        <div className="mt-3 bg-white/60 dark:bg-black/20 rounded-xl p-3">
          <p className="text-xs text-slate-500 font-medium mb-1">ملاحظة الإدارة:</p>
          <p className="text-sm text-slate-700 dark:text-slate-200">{payment.adminNotes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Current subscription status — real DB data only, no form state ──────────
function CurrentSubscriptionStatus({ expiresAt }: { expiresAt: string | null | undefined }) {
  const isActive = !!expiresAt && new Date(expiresAt).getTime() > Date.now();

  const formattedDate = expiresAt
    ? new Date(expiresAt).toLocaleDateString("ar-DZ", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <div
      className={`glass-panel rounded-3xl p-5 border-2 flex items-center gap-3 ${
        isActive
          ? "border-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/10"
          : "border-red-300 bg-red-50/30 dark:bg-red-900/10"
      }`}
    >
      <div
        className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
          isActive ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" : "bg-red-100 dark:bg-red-900/30 text-red-500"
        }`}
      >
        {isActive ? <CalendarDays className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
      </div>
      <div>
        <p className={`font-bold ${isActive ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
          {isActive ? "الاشتراك نشط" : "انتهى الاشتراك"}
        </p>
        <p className="text-sm text-slate-500">
          {isActive ? `نشط حتى: ${formattedDate}` : "الرجاء رفع وصل دفع لتجديد الاشتراك"}
        </p>
      </div>
    </div>
  );
}

// ─── Upload receipt form ───────────────────────────────────────────────────────
interface UploadFormProps {
  imagePreview: string | null;
  dragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onChooseFile: () => void;
  onClear: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error: string | null;
}

function UploadReceiptForm({
  imagePreview,
  dragOver,
  fileInputRef,
  onFileChange,
  onDrop,
  onDragOver,
  onDragLeave,
  onChooseFile,
  onClear,
  onSubmit,
  isSubmitting,
  error,
}: UploadFormProps) {
  const { t } = useTranslation();
  return (
    <div className="glass-panel rounded-3xl p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
          <Upload className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="font-bold text-slate-800 dark:text-white">{t("subscription.upload")}</h2>
          <p className="text-xs text-slate-500">ارفع صورة واضحة لوصل الدفع</p>
        </div>
      </div>

      {/* Drop zone */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileChange}
      />

      {!imagePreview ? (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={onChooseFile}
          className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-4 cursor-pointer transition-all duration-200 ${
            dragOver
              ? "border-primary bg-primary/5 scale-[1.01]"
              : "border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:bg-primary/3"
          }`}
        >
          <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center">
            <ImageIcon className="w-8 h-8 text-slate-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-slate-700 dark:text-slate-200">
              {dragOver ? "أفلت الصورة هنا" : "اضغط لاختيار صورة"}
            </p>
            <p className="text-xs text-slate-400 mt-1">أو اسحب وأفلت الصورة هنا</p>
            <p className="text-xs text-slate-400">PNG، JPG، JPEG</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700">
            <img
              src={imagePreview}
              alt="صورة الوصل"
              className="w-full max-h-72 object-contain bg-slate-50 dark:bg-slate-900"
            />
            <button
              onClick={onClear}
              className="absolute top-2 left-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg"
            >
              <XCircle className="w-5 h-5" />
            </button>
            <div className="absolute bottom-2 right-2 bg-emerald-500 text-white text-xs px-3 py-1 rounded-full font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              تم اختيار الصورة
            </div>
          </div>
          <p className="text-xs text-slate-500 text-center">
            تأكد من وضوح الصورة وظهور جميع بيانات الوصل
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={onSubmit}
        disabled={!imagePreview || isSubmitting}
        className="w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-white bg-gradient-to-r from-primary to-cyan-500 shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {t("subscription.pending")}...
          </>
        ) : (
          <>
            <CreditCard className="w-5 h-5" />
            {t("subscription.submit")}
          </>
        )}
      </button>
    </div>
  );
}
