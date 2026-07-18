import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useRegisterRequest, useVerifyOtp, useSubmitDriverDocs, customFetch } from "@workspace/api-client-react";
import {
  User, Mail, Lock, Phone, Loader2, ArrowRight,
  Car, UserCircle, ShieldCheck, RefreshCw, Clock,
  MapPin, ChevronDown, Camera, FileText,
  Upload, CheckCircle2, AlertCircle, X,
  Gift, CreditCard as CreditCardIcon, Sparkles,
  PartyPopper, Timer,
} from "lucide-react";
import { Link } from "wouter";
import { WILAYAS } from "@/data/algeria";
import { uploadDriverFile } from "@/lib/supabase";
import { compressImage } from "@/lib/compress-image";
import { WaterDrops, AuthControls } from "@/components/layout";
import { useTranslation } from "@/lib/i18n";

type UserType = "مستهلك" | "سائق";
type Screen   = "form" | "otp" | "upload" | "gate";

const OTP_EXPIRY_SECS = 10 * 60;

export interface VerifiedSession {
  userId: string;
  name: string;
  email: string;
  userType: string;
}

export default function Register() {
  const [screen, setScreen]               = useState<Screen>("form");
  const [pendingEmail, setPendingEmail]   = useState("");
  const [verifiedSession, setVerifiedSession] = useState<VerifiedSession | null>(null);

  const handleOtpVerified = (session: VerifiedSession) => {
    setVerifiedSession(session);
    if (session.userType === "سائق") setScreen("upload");
  };

  return (
    <div className="min-h-[100dvh] flex flex-col p-6 relative overflow-x-hidden bg-gradient-to-b from-blue-50 to-white dark:from-slate-900 dark:to-slate-950 pb-20 pt-12">
      <AuthControls />
      <WaterDrops />
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-400/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob pointer-events-none" />
      <div className="w-full max-w-sm mx-auto relative z-10 flex flex-col">
        {screen === "form" && (
          <RegistrationForm onOtpSent={(email) => { setPendingEmail(email); setScreen("otp"); }} />
        )}
        {screen === "otp" && (
          <OtpVerification email={pendingEmail} onBack={() => setScreen("form")} onVerified={handleOtpVerified} />
        )}
        {screen === "upload" && verifiedSession && (
          <DriverDocsUpload session={verifiedSession} onComplete={() => setScreen("gate")} />
        )}
        {screen === "gate" && verifiedSession && (
          <SubscriptionGate session={verifiedSession} />
        )}
      </div>
    </div>
  );
}

const REG_DRAFT_KEY = "reg_draft";

function RegistrationForm({ onOtpSent }: { onOtpSent: (email: string) => void }) {
  const { t } = useTranslation();
  const [userType, setUserType] = useState<UserType | null>(null);
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone]       = useState("");
  const [wilaya, setWilaya]     = useState("");
  const [commune, setCommune]   = useState("");
  const [error, setError]       = useState("");
  const requestMutation = useRegisterRequest();

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(REG_DRAFT_KEY) || "{}");
      if (draft.name)     setName(draft.name);
      if (draft.email)    setEmail(draft.email);
      if (draft.phone)    setPhone(draft.phone);
      if (draft.wilaya)   setWilaya(draft.wilaya);
      if (draft.commune)  setCommune(draft.commune);
      if (draft.userType) setUserType(draft.userType as UserType);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!name && !email && !phone) return;
    try {
      localStorage.setItem(REG_DRAFT_KEY, JSON.stringify({ name, email, phone, wilaya, commune, userType }));
    } catch { /* ignore */ }
  }, [name, email, phone, wilaya, commune, userType]);

  const selectedWilaya = WILAYAS.find(w => w.name === wilaya);
  const communes = selectedWilaya?.communes ?? [];

  const handleWilayaChange = (val: string) => { setWilaya(val); setCommune(""); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!userType)  { setError(t("register.error.role")); return; }
    if (!name || !email || !password || !phone) { setError(t("register.error.fields")); return; }
    if (!wilaya)    { setError(t("register.error.wilaya")); return; }
    if (!commune)   { setError(t("register.error.commune")); return; }
    requestMutation.mutate(
      { data: { name, email, password, phone, userType, wilaya, commune } },
      {
        onSuccess: () => {
          localStorage.removeItem(REG_DRAFT_KEY);
          onOtpSent(email);
        },
        onError: (err: unknown) => {
          console.error("[REGISTER REQUEST ERROR]", err);
          const e = err as { data?: { error?: string }; message?: string };
          setError(e?.data?.error || e?.message || "حدث خطأ أثناء التسجيل");
        },
      }
    );
  };

  return (
    <>
      <div className="mb-8">
        <Link href="/" className="inline-flex items-center text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors mb-6" data-testid="link-back-login">
          <ArrowRight className="w-4 h-4 ml-1" /><span>{t("register.back")}</span>
        </Link>
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-1">{t("register.title")}</h1>
        <p className="text-slate-500 dark:text-slate-400">{t("register.subtitle")}</p>
      </div>
      {error && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-2xl mb-6 text-center animate-in fade-in slide-in-from-top-1">{error}</div>
      )}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {(["مستهلك", "سائق"] as UserType[]).map((role) => (
          <button key={role} type="button" onClick={() => setUserType(role)}
            className={`flex flex-col items-center justify-center p-4 rounded-3xl border-2 transition-all ${
              userType === role
                ? "border-primary bg-primary/5 text-primary shadow-md shadow-primary/10"
                : "border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-black/50 text-slate-500 hover:border-primary/30"
            }`}
            data-testid={role === "مستهلك" ? "role-consumer" : "role-driver"}
          >
            {role === "مستهلك"
              ? <UserCircle className={`w-8 h-8 mb-2 ${userType === role ? "text-primary" : "text-slate-400"}`} />
              : <Car className={`w-8 h-8 mb-2 ${userType === role ? "text-primary" : "text-slate-400"}`} />
            }
            <span className="font-bold">{role === "مستهلك" ? t("register.role.consumer") : t("register.role.driver")}</span>
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="glass-panel rounded-3xl p-6">
        <div className="space-y-4">
          <Field icon={<User className="h-5 w-5" />}  type="text"     placeholder={t("register.name")}     value={name}     onChange={setName}     testId="input-name" />
          <Field icon={<Mail className="h-5 w-5" />}  type="email"    placeholder={t("register.email")}    value={email}    onChange={setEmail}    testId="input-email" />
          <Field icon={<Phone className="h-5 w-5" />} type="tel"      placeholder={t("register.phone")}    value={phone}    onChange={setPhone}    testId="input-phone" />
          <Field icon={<Lock className="h-5 w-5" />}  type="password" placeholder={t("register.password")} value={password} onChange={setPassword} testId="input-password" />
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
              <MapPin className="w-3.5 h-3.5 text-primary" /><span>موقعك الجغرافي</span>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400"><MapPin className="h-5 w-5" /></div>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><ChevronDown className="h-4 w-4" /></div>
              <select value={wilaya} onChange={(e) => handleWilayaChange(e.target.value)}
                className="w-full bg-white/50 dark:bg-black/50 border border-slate-200 dark:border-slate-800 rounded-2xl py-3 pr-10 pl-8 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none text-right"
                dir="rtl" data-testid="select-wilaya">
                <option value="">{t("register.wilaya")}</option>
                {WILAYAS.map((w) => (
                  <option key={w.code} value={w.name}>{w.code.toString().padStart(2, "0")} - {w.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400"><MapPin className="h-5 w-5 text-primary/60" /></div>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><ChevronDown className="h-4 w-4" /></div>
              <select value={commune} onChange={(e) => setCommune(e.target.value)} disabled={!wilaya}
                className="w-full bg-white/50 dark:bg-black/50 border border-slate-200 dark:border-slate-800 rounded-2xl py-3 pr-10 pl-8 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none text-right disabled:opacity-40 disabled:cursor-not-allowed"
                dir="rtl" data-testid="select-commune">
                <option value="">{wilaya ? t("register.commune") : t("register.wilaya")}</option>
                {communes.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            {wilaya && commune && (
              <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl px-3 py-2 animate-in fade-in duration-300">
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs text-primary font-bold">{commune}، {wilaya}</span>
              </div>
            )}
          </div>
          <button type="submit" disabled={requestMutation.isPending || !userType}
            className="w-full mt-2 bg-primary hover:bg-primary/90 text-white font-medium py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-md shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            data-testid="button-submit-register">
            {requestMutation.isPending
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <><ShieldCheck className="w-5 h-5" /><span>{t("register.submit")}</span></>}
          </button>
        </div>
      </form>
    </>
  );
}

function Field({ icon, type, placeholder, value, onChange, testId }: {
  icon: React.ReactNode; type: string; placeholder: string;
  value: string; onChange: (v: string) => void; testId: string;
}) {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">{icon}</div>
      <input type={type} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/50 dark:bg-black/50 border border-slate-200 dark:border-slate-800 rounded-2xl py-3 pr-10 pl-4 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
        dir="rtl" data-testid={testId} />
    </div>
  );
}

function OtpVerification({ email, onBack, onVerified }: {
  email: string; onBack: () => void; onVerified: (session: VerifiedSession) => void;
}) {
  const [, setLocation] = useLocation();
  const { setAuth } = useAuth();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [error, setError]   = useState("");
  const [secondsLeft, setSecondsLeft] = useState(OTP_EXPIRY_SECS);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const verifyMutation = useVerifyOtp();

  useEffect(() => {
    const id = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const seconds = String(secondsLeft % 60).padStart(2, "0");
  const progress = ((OTP_EXPIRY_SECS - secondsLeft) / OTP_EXPIRY_SECS) * 100;
  const isExpired = secondsLeft === 0;
  const otp = digits.join("");

  const handleDigit = useCallback((idx: number, val: string) => {
    const char = val.replace(/\D/g, "").slice(-1);
    setDigits(prev => { const next = [...prev]; next[idx] = char; return next; });
    if (char && idx < 5) inputRefs.current[idx + 1]?.focus();
  }, []);

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) inputRefs.current[idx - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const next = Array(6).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 6) { setError("يرجى إدخال الرمز المكوّن من 6 أرقام كاملاً"); return; }
    if (isExpired)       { setError("انتهت صلاحية الرمز، يرجى العودة والتسجيل من جديد"); return; }
    setError("");
    verifyMutation.mutate({ data: { email, otp } }, {
      onSuccess: (data: any) => {
        setAuth({ userId: data.userId, name: data.name, email: data.email, userType: data.userType, sessionToken: data.sessionToken, refreshToken: data.refreshToken });
        if (data.userType === "سائق") {
          onVerified({ userId: data.userId, name: data.name, email: data.email, userType: data.userType });
        } else {
          setLocation("/dashboard");
        }
      },
      onError: (err: unknown) => {
        console.error("[OTP VERIFY ERROR]", err);
        const e = err as { data?: { error?: string }; message?: string };
        setError(e?.data?.error || e?.message || "رمز التحقق غير صحيح");
        setDigits(Array(6).fill(""));
        inputRefs.current[0]?.focus();
      },
    });
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button onClick={onBack} className="inline-flex items-center text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors mb-6" data-testid="button-back-to-form">
        <ArrowRight className="w-4 h-4 ml-1" /> تعديل البيانات
      </button>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">تأكيد البريد الإلكتروني</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
          أرسلنا رمزاً مكوّناً من 6 أرقام إلى<br />
          <span className="font-semibold text-primary">{email}</span>
        </p>
      </div>
      <div className="glass-panel rounded-3xl p-6 flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center w-24 h-24">
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-200 dark:text-slate-700" />
            <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="6"
              strokeDasharray={`${2 * Math.PI * 40}`}
              strokeDashoffset={`${2 * Math.PI * 40 * (progress / 100)}`}
              strokeLinecap="round"
              className={`transition-all duration-1000 ${isExpired ? "text-destructive" : secondsLeft < 60 ? "text-amber-500" : "text-primary"}`} />
          </svg>
          <div className="z-10 flex flex-col items-center">
            <Clock className={`w-4 h-4 mb-0.5 ${isExpired ? "text-destructive" : "text-primary"}`} />
            <span className={`text-sm font-black tabular-nums ${isExpired ? "text-destructive" : secondsLeft < 60 ? "text-amber-600" : "text-primary"}`}>
              {minutes}:{seconds}
            </span>
          </div>
        </div>
        {error && (
          <div className="w-full bg-destructive/10 text-destructive text-sm p-3 rounded-2xl text-center">{error}</div>
        )}
        <form onSubmit={handleVerify} className="w-full flex flex-col gap-6">
          <div className="flex gap-2 justify-center" dir="ltr" onPaste={handlePaste} data-testid="otp-input-row">
            {digits.map((d, i) => (
              <input key={i} ref={el => { inputRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={1}
                value={d} onChange={e => handleDigit(i, e.target.value)} onKeyDown={e => handleKeyDown(i, e)}
                disabled={isExpired}
                className={`w-11 h-14 text-center text-xl font-black rounded-2xl border-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white/60 dark:bg-black/60
                  ${d ? "border-primary text-primary" : "border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white"}
                  ${isExpired ? "opacity-50 cursor-not-allowed" : ""}`}
                data-testid={`otp-digit-${i}`} />
            ))}
          </div>
          <button type="submit" disabled={verifyMutation.isPending || otp.length < 6 || isExpired}
            className="w-full bg-gradient-to-r from-primary to-cyan-500 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-verify-otp">
            {verifyMutation.isPending
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <><ShieldCheck className="w-5 h-5" /> تأكيد الحساب</>}
          </button>
        </form>
        {isExpired ? (
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-primary font-semibold hover:underline" data-testid="button-resend-otp">
            <RefreshCw className="w-4 h-4" /> إعادة الإرسال
          </button>
        ) : (
          <p className="text-xs text-slate-400 text-center">لم يصلك الرمز؟ تحقق من مجلد الرسائل غير المرغوب فيها</p>
        )}
      </div>
    </div>
  );
}

type UploadSlot = "truck-front" | "license";
type SlotState  = { file: File | null; url: string | null; uploading: boolean; error: string | null };
const INITIAL_SLOT: SlotState = { file: null, url: null, uploading: false, error: null };

export function DriverDocsUpload({ session, onComplete }: { session: VerifiedSession; onComplete: () => void }) {
  const submitDocsMutation = useSubmitDriverDocs();

  const [slots, setSlots] = useState<Record<UploadSlot, SlotState>>({
    "truck-front": { ...INITIAL_SLOT },
    "license":     { ...INITIAL_SLOT },
  });
  const [globalError, setGlobalError] = useState("");
  const [submitting, setSubmitting]   = useState(false);

  const frontRef   = useRef<HTMLInputElement>(null);
  const licenseRef = useRef<HTMLInputElement>(null);
  const refs: Record<UploadSlot, React.RefObject<HTMLInputElement | null>> = {
    "truck-front": frontRef,
    "license":     licenseRef,
  };

  const allUploaded = (["truck-front", "license"] as UploadSlot[]).every(s => slots[s].url !== null);

  const handleFileChange = async (slot: UploadSlot, file: File | null) => {
    if (!file) return;
    setSlots(prev => ({ ...prev, [slot]: { file, url: null, uploading: true, error: null } }));
    try {
      const url = await uploadDriverFile(session.userId, slot, file);
      setSlots(prev => ({ ...prev, [slot]: { file, url, uploading: false, error: null } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل الرفع";
      setSlots(prev => ({ ...prev, [slot]: { file: null, url: null, uploading: false, error: msg } }));
    }
  };

  const removeFile = (slot: UploadSlot) => {
    setSlots(prev => ({ ...prev, [slot]: { ...INITIAL_SLOT } }));
    const ref = refs[slot];
    if (ref.current) ref.current.value = "";
  };

  const [showTrialModal, setShowTrialModal] = useState(false);
  const [, navigate] = useLocation();

  const handleSubmit = async () => {
    if (!allUploaded) return;
    setGlobalError("");
    setSubmitting(true);
    try {
      await submitDocsMutation.mutateAsync({
        driverId: session.userId,
        data: {
          truckFrontPhotoUrl: slots["truck-front"].url!,
          driverLicenseUrl:   slots["license"].url!,
          truckVideoUrl:     "",
          truckSidePhotoUrl: "",
        },
      });
      setShowTrialModal(true);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      setGlobalError(e?.data?.error || e?.message || "حدث خطأ أثناء حفظ الوثائق");
    } finally {
      setSubmitting(false);
    }
  };

  const slotDefs: {
    slot: UploadSlot; label: string; hint: string;
    icon: React.ReactNode; accept: string; ref: React.RefObject<HTMLInputElement | null>;
  }[] = [
    { slot: "truck-front", label: "صورة الشاحنة من الأمام", hint: "يجب أن تظهر لوحة الترقيم بوضوح", icon: <Camera className="w-6 h-6" />, accept: "image/*", ref: frontRef },
    { slot: "license",     label: "صورة رخصة القيادة",      hint: "صورة واضحة لرخصة القيادة الرسمية",   icon: <FileText className="w-6 h-6" />, accept: "image/*", ref: licenseRef },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" dir="rtl">
      {/* ── Trial welcome modal ────────────────────────────────────────── */}
      {showTrialModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-7 flex flex-col items-center text-center gap-4 animate-in zoom-in-95 duration-300">
            {/* Party icon */}
            <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <PartyPopper className="w-8 h-8 text-amber-500" />
            </div>

            <h2 className="text-xl font-bold text-slate-800 dark:text-white">🎉 مرحباً بك في مجتمعنا</h2>

            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              تم إرسال ملفك إلى جهة الإدارة لمعاينتها. لقد منحناك{" "}
              <span className="font-bold text-primary">3 أيام تجريبية</span>{" "}
              حتى تتم الموافقة على ملفك.
            </p>

            {/* 3-day badge */}
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-2xl px-5 py-3">
              <Timer className="w-5 h-5 text-primary shrink-0" />
              <span className="text-2xl font-black text-primary tracking-wide">3 أيام</span>
              <span className="text-sm text-primary/70 font-medium">متبقية</span>
            </div>

            <button
              onClick={() => navigate("/driver-dashboard")}
              className="w-full bg-gradient-to-r from-primary to-cyan-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98]"
            >
              حسناً، متابعة
            </button>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Upload className="w-5 h-5 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">رفع وثائق التحقق</h1>
        </div>
        <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
          مرحباً <span className="font-bold text-primary">{session.name}</span>، يرجى رفع الوثائق التالية للتحقق من هويتك كسائق.
        </p>
      </div>

      {globalError && (
        <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-2xl mb-5 text-center flex items-center gap-2 justify-center">
          <AlertCircle className="w-4 h-4 shrink-0" />{globalError}
        </div>
      )}

      <div className="space-y-4 mb-6">
        {slotDefs.map(({ slot, label, hint, icon, accept, ref }) => (
          <UploadCard key={slot} label={label} hint={hint} icon={icon} accept={accept}
            state={slots[slot]} inputRef={ref}
            onFileChange={(f) => handleFileChange(slot, f)}
            onRemove={() => removeFile(slot)} />
        ))}
      </div>

      <div className="glass-panel rounded-3xl p-4 mb-5 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed font-medium">
          سيتم مراجعة وثائقك من قِبل الإدارة. ستحصل على 3 أيام تجريبية فور الإرسال.
        </p>
      </div>

      <button onClick={handleSubmit} disabled={!allUploaded || submitting}
        className="w-full bg-gradient-to-r from-primary to-cyan-500 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="button-submit-docs">
        {submitting
          ? <><Loader2 className="w-5 h-5 animate-spin" /> جارٍ إرسال الوثائق...</>
          : allUploaded
            ? <><CheckCircle2 className="w-5 h-5" /> إرسال الوثائق وتفعيل الحساب</>
            : <><Upload className="w-5 h-5" /> يرجى رفع جميع الوثائق أولاً</>}
      </button>
    </div>
  );
}

function UploadCard({ label, hint, icon, accept, state, inputRef, onFileChange, onRemove }: {
  label: string; hint: string; icon: React.ReactNode; accept: string;
  state: SlotState; inputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (f: File) => void; onRemove: () => void;
}) {
  const isDone = state.url !== null;
  const isUploading = state.uploading;
  const hasError = state.error !== null;

  return (
    <div className={`glass-panel rounded-2xl p-4 border-2 transition-all ${
      isDone ? "border-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/10"
      : hasError  ? "border-destructive/50 bg-destructive/5"
      : isUploading ? "border-primary/50 bg-primary/5"
      : "border-slate-200 dark:border-slate-700"
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isDone ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600"
          : hasError ? "bg-destructive/10 text-destructive"
          : "bg-primary/10 text-primary"
        }`}>
          {isDone ? <CheckCircle2 className="w-5 h-5" /> : icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-800 dark:text-white leading-tight mb-0.5">{label}</p>
          <p className="text-xs text-slate-400 leading-relaxed">{hint}</p>
          {hasError && <p className="text-xs text-destructive mt-1 font-medium">{state.error}</p>}
          {isDone && state.file && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium truncate">✅ {state.file.name}</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {isUploading && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
          {isDone && (
            <button type="button" onClick={onRemove}
              className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-destructive hover:bg-destructive/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
          {!isDone && !isUploading && (
            <button type="button" onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors">
              اختيار
            </button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChange(f); }} />
    </div>
  );
}

// ─── Subscription Gate (shown after docs upload) ──────────────────────────────
function SubscriptionGate({ session }: { session: VerifiedSession }) {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activateFreeTrial = async () => {
    setLoading(true);
    setError("");
    try {
      await customFetch(`/api/driver/${session.userId}/free-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      setLocation("/driver-dashboard");
    } catch (err: any) {
      setError(err?.data?.error || "تعذّر الاتصال بالخادم، يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" dir="rtl">
      <div className="mb-8 text-center">
        <div className="w-20 h-20 bg-gradient-to-tr from-primary to-cyan-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary/30">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-black text-slate-800 dark:text-white mb-2">
          مرحباً {session.name}! 🎉
        </h1>
        <p className="text-slate-500 text-sm leading-relaxed">
          تم إنشاء حسابك بنجاح. اختر طريقة الاشتراك للبدء
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-2xl p-3 mb-4 text-sm text-red-700 dark:text-red-300 text-center">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* Free trial card */}
        <button
          onClick={activateFreeTrial}
          disabled={loading}
          className="w-full glass-panel rounded-3xl p-6 text-right border-2 border-emerald-300 dark:border-emerald-700 hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-500/10 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center shrink-0">
              {loading ? <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" /> : <Gift className="w-7 h-7 text-emerald-600" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-black text-slate-800 dark:text-white text-lg">تجربة مجانية</span>
                <span className="bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">مجاناً</span>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                استمتع بـ 30 يوماً مجانياً لاستقبال طلبات المياه بدون أي رسوم
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
          </div>
        </button>

        {/* Pay now card */}
        <button
          onClick={() => setLocation("/subscription")}
          className="w-full glass-panel rounded-3xl p-6 text-right border-2 border-primary/30 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10 transition-all active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
              <CreditCardIcon className="w-7 h-7 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-black text-slate-800 dark:text-white text-lg">الدفع الآن</span>
                <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-0.5 rounded-full">1000 دج / شهر</span>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">
                اشترك مباشرةً وارفع وصل الدفع للبدء فوراً
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
          </div>
        </button>
      </div>

      <p className="text-xs text-slate-400 text-center mt-6 leading-relaxed">
        يمكنك دائماً تجديد اشتراكك لاحقاً من صفحة الاشتراك في لوحة تحكم السائق
      </p>
    </div>
  );
}
