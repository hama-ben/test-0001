import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { NotificationSoundSettings } from "@/components/notification-sound-settings";
import { CustomerServiceModal } from "@/components/customer-service-modal";
import {
  DRIVER_ORDER_SOUND_KEY,
  CONSUMER_ARRIVAL_SOUND_KEY,
} from "@/hooks/use-notification-sound";
import {
  ArrowRight, UserCircle, Mail, Phone, Shield,
  Lock, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle,
  Star, HeadphonesIcon,
} from "lucide-react";

export default function ProfilePage() {
  const { userId } = useAuth();
  const [, setLocation] = useLocation();

  if (!userId) { setLocation("/"); return null; }

  return (
    <Layout>
      <ProfileContent />
    </Layout>
  );
}

function ProfileContent() {
  const { name, email, userType, userId } = useAuth();
  const [, setLocation] = useLocation();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const [showSupportModal, setShowSupportModal] = useState(false);

  // Driver average rating
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [totalRatings, setTotalRatings] = useState(0);

  useEffect(() => {
    if (userType !== "سائق" || !userId) return;
    customFetch<{ avgStars: number | null; total: number }>(`/api/driver/${userId}/rating`)
      .then((data) => {
        setAvgRating(data.avgStars);
        setTotalRatings(data.total);
      })
      .catch(() => {});
  }, [userId, userType]);

  const handleBack = () => {
    if (userType === "سائق") setLocation("/driver-dashboard");
    else setLocation("/dashboard");
  };

  const handleChangePassword = async () => {
    setError("");
    setSuccess("");

    if (!oldPassword || !newPassword || !confirmPassword) {
      setError("يرجى ملء جميع حقول كلمة المرور");
      return;
    }
    if (newPassword.length < 6) {
      setError("كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("كلمة المرور الجديدة وتأكيدها غير متطابقتين");
      return;
    }

    setLoading(true);
    try {
      await customFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      setSuccess("تم تغيير كلمة المرور بنجاح ✔");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.data?.error ?? "تعذّر الاتصال بالخادم. يرجى التحقق من الاتصال بالإنترنت.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full animate-in fade-in duration-500" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <ArrowRight className="w-5 h-5 text-slate-600 dark:text-slate-300" />
        </button>
        <h1 className="text-xl font-black text-slate-800 dark:text-white">الملف الشخصي</h1>
      </div>

      {/* Profile info card */}
      <div className="glass-panel rounded-3xl p-6 border border-primary/20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <UserCircle className="w-9 h-9 text-primary" />
          </div>
          <div>
            <p className="font-black text-lg text-slate-800 dark:text-white">{name}</p>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {userType === "سائق" ? "سائق" : "مستهلك"}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4">
            <Mail className="w-5 h-5 text-slate-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-slate-400 mb-0.5">البريد الإلكتروني</p>
              <p className="font-medium text-slate-800 dark:text-white text-sm truncate">{email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4">
            <Shield className="w-5 h-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-400 mb-0.5">حالة الحساب</p>
              <p className="font-medium text-emerald-600 dark:text-emerald-400 text-sm">نشط</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Feature 1: Driver star rating display ───────────────────────── */}
      {userType === "سائق" && (
        <div className="glass-panel rounded-3xl p-6 border border-amber-200 dark:border-amber-700/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-center justify-center">
              <Star className="w-5 h-5 text-amber-500 fill-amber-500" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-white">تقييمي الإجمالي</h2>
              <p className="text-xs text-slate-400">تقييمات العملاء لأدائك</p>
            </div>
          </div>

          {avgRating === null && totalRatings === 0 ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className="w-7 h-7 text-slate-200 dark:text-slate-700" />
                ))}
              </div>
              <p className="text-sm text-slate-400">لا توجد تقييمات بعد</p>
              <p className="text-xs text-slate-300 dark:text-slate-600">ستظهر تقييمات العملاء هنا بعد أول توصيل</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {/* Star icons */}
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = avgRating !== null && n <= Math.round(avgRating);
                  const half   = avgRating !== null && !filled && n - 0.5 <= avgRating;
                  return (
                    <Star
                      key={n}
                      className={`w-8 h-8 transition-colors ${
                        filled ? "fill-amber-400 text-amber-400"
                        : half  ? "fill-amber-200 text-amber-300"
                        : "text-slate-200 dark:text-slate-700"
                      }`}
                    />
                  );
                })}
              </div>
              {/* Numeric value */}
              <div className="text-center">
                <span className="text-3xl font-black text-slate-800 dark:text-white">
                  {avgRating !== null ? avgRating.toFixed(1) : "—"}
                </span>
                <span className="text-slate-400 text-lg font-medium"> / 5</span>
              </div>
              <p className="text-sm text-slate-500">
                بناءً على <span className="font-bold text-slate-700 dark:text-slate-200">{totalRatings}</span>{" "}
                {totalRatings === 1 ? "تقييم" : "تقييمات"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Feature 4/6: Notification sound settings ────────────────────── */}
      {userType === "سائق" ? (
        <NotificationSoundSettings
          storageKey={DRIVER_ORDER_SOUND_KEY}
          title="صوت إشعار الطلب الجديد"
          description="النغمة التي تُشغَّل عند وصول طلب جديد"
        />
      ) : (
        <NotificationSoundSettings
          storageKey={CONSUMER_ARRIVAL_SOUND_KEY}
          title="صوت إشعار وصول السائق"
          description="النغمة التي تُشغَّل عند وصول السائق إلى منزلك"
        />
      )}

      {/* Password change card */}
      <div className="glass-panel rounded-3xl p-6 border border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-center justify-center">
            <Lock className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800 dark:text-white">تغيير كلمة المرور</h2>
            <p className="text-xs text-slate-400">أدخل كلمتك الحالية ثم الجديدة</p>
          </div>
        </div>

        <div className="space-y-4">
          <PasswordField
            label="كلمة المرور الحالية"
            value={oldPassword}
            onChange={setOldPassword}
            show={showOld}
            onToggle={() => setShowOld(v => !v)}
            placeholder="أدخل كلمة مرورك الحالية"
          />
          <PasswordField
            label="كلمة المرور الجديدة"
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggle={() => setShowNew(v => !v)}
            placeholder="6 أحرف على الأقل"
          />
          <PasswordField
            label="تأكيد كلمة المرور الجديدة"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showConfirm}
            onToggle={() => setShowConfirm(v => !v)}
            placeholder="أعد كتابة كلمة المرور الجديدة"
          />
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-2xl p-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <p className="text-sm text-emerald-700 dark:text-emerald-300">{success}</p>
          </div>
        )}

        <button
          onClick={handleChangePassword}
          disabled={loading}
          className="mt-5 w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-white bg-gradient-to-r from-primary to-cyan-500 shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? (
            <><Loader2 className="w-5 h-5 animate-spin" />جارٍ الحفظ...</>
          ) : (
            <><Lock className="w-5 h-5" />حفظ كلمة المرور الجديدة</>
          )}
        </button>
      </div>

      {/* ── Feature 5: Customer service ──────────────────────────────────── */}
      <div className="glass-panel rounded-3xl p-6 border border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-sky-50 dark:bg-sky-900/20 rounded-xl flex items-center justify-center">
            <HeadphonesIcon className="w-5 h-5 text-sky-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800 dark:text-white">خدمة العملاء</h2>
            <p className="text-xs text-slate-400">تواصل مع فريق الدعم</p>
          </div>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
          هل واجهت مشكلة؟ هل لديك اقتراح؟ تواصل معنا مباشرةً وسنرد عليك في أقرب وقت.
        </p>
        <button
          onClick={() => setShowSupportModal(true)}
          className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-white bg-gradient-to-r from-sky-500 to-cyan-500 shadow-md shadow-sky-400/25 hover:opacity-90 transition-all active:scale-[0.98]"
        >
          <HeadphonesIcon className="w-5 h-5" />
          مراسلة فريق الدعم
        </button>
      </div>

      {/* Customer service modal */}
      {showSupportModal && (
        <CustomerServiceModal
          userName={name ?? ""}
          userEmail={email ?? ""}
          userType={userType ?? ""}
          onClose={() => setShowSupportModal(false)}
        />
      )}
    </div>
  );
}

function PasswordField({
  label, value, onChange, show, onToggle, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5 block">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 pr-12 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-sm"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute top-1/2 -translate-y-1/2 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
