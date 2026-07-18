import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/layout";
import { useTranslation } from "@/lib/i18n";
import { useCreateOrder, useGetUserOrders, getGetUserOrdersQueryKey, customFetch } from "@workspace/api-client-react";
import { useCancelOrder } from "@/hooks/use-cancel-order";
import { useQueryClient } from "@tanstack/react-query";
import {
  Droplet, ShoppingBag, ListOrdered, CheckCircle2,
  Truck, Clock, ArrowRight, Loader2, MapPin, Bell, X,
  User, Phone, XCircle, Star, Bookmark, BookmarkCheck, Trash2,
  HeadphonesIcon,
} from "lucide-react";
import { useRealtimeOrderStatus } from "@/hooks/use-realtime-order-status";
import { format } from "date-fns";
import { playNotificationSound, stopNotificationSound, CONSUMER_ARRIVAL_SOUND_KEY } from "@/hooks/use-notification-sound";
import { useSupportChatStore } from "@/stores/support-chat";
import { supabase } from "@/lib/supabase";
import { getSessionBootReady } from "@/hooks/use-auth";

type View = "menu" | "new-order" | "my-orders";

const VOLUMES = ["5ل", "10ل", "15ل", "20ل", "30ل", "40ل", "50ل", "100ل", "150ل", "200ل", "300ل", "500ل", "1000ل"];

const PRICE_MAP: Record<string, number> = {
  "5ل": 20, "10ل": 30, "15ل": 40, "20ل": 60,
  "30ل": 70, "40ل": 100, "50ل": 120, "100ل": 250,
  "150ل": 300, "200ل": 400, "300ل": 600, "500ل": 1000,
  "1000ل": 1600,
};


interface DriverAcceptedInfo {
  driverName: string | null;
  driverPhone: string | null;
  orderId: string;
}

export default function Dashboard() {
  const { userId, userType, name, email } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("menu");
  const [showArrivalModal, setShowArrivalModal] = useState(false);
  const [showDriverAcceptedModal, setShowDriverAcceptedModal] = useState(false);
  const [driverAcceptedInfo, setDriverAcceptedInfo] = useState<DriverAcceptedInfo | null>(null);
  const arrivedOrderIdRef = useRef<string | null>(null);
  const acceptedOrderIdRef = useRef<Set<string>>(new Set());
  const arrivalLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openSupport = useSupportChatStore((s) => s.open);

  if (!userId) { setLocation("/"); return null; }
  if (userType === "سائق") { setLocation("/driver-dashboard"); return null; }

  const startArrivalLoop = () => {
    stopArrivalLoop();
    playNotificationSound(CONSUMER_ARRIVAL_SOUND_KEY);
    arrivalLoopRef.current = setInterval(() => { playNotificationSound(CONSUMER_ARRIVAL_SOUND_KEY); }, 3000);
  };

  const stopArrivalLoop = () => {
    if (arrivalLoopRef.current !== null) {
      clearInterval(arrivalLoopRef.current);
      arrivalLoopRef.current = null;
    }
    // Stop any custom audio that may still be playing from the last interval tick
    stopNotificationSound();
  };

  const handleAcknowledge = () => { stopArrivalLoop(); setShowArrivalModal(false); };

  return (
    <Layout>
      {showArrivalModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 mx-4 max-w-sm w-full shadow-2xl border border-sky-200 dark:border-sky-800 text-center animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5 animate-bounce">
              <Truck className="w-10 h-10 text-amber-500" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-3">{t("dashboard.order.arrived")}</h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
              {t("dashboard.order.arrivedDesc")}
            </p>
            <button onClick={handleAcknowledge}
              className="w-full bg-gradient-to-r from-amber-400 to-orange-500 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-amber-400/30 hover:opacity-90 transition-all active:scale-[0.98]"
              data-testid="button-close-arrival-modal">
              حسناً، في الطريق
            </button>
          </div>
        </div>
      )}

      {showDriverAcceptedModal && driverAcceptedInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 mx-4 max-w-sm w-full shadow-2xl border border-emerald-200 dark:border-emerald-800 text-center animate-in zoom-in-95 duration-300" dir="rtl">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <Truck className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-xl font-black text-slate-800 dark:text-white mb-2">{t("dashboard.order.accepted")}</h2>
            <p className="text-slate-500 text-sm mb-4">السائق التالي في طريقه إليك</p>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-2xl p-4 space-y-3 text-right mb-6">
              {driverAcceptedInfo.driverName && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">اسم السائق</p>
                    <p className="font-bold text-slate-800 dark:text-white">{driverAcceptedInfo.driverName}</p>
                  </div>
                </div>
              )}
              {driverAcceptedInfo.driverPhone && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                    <Phone className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">رقم الهاتف</p>
                    <a href={`tel:${driverAcceptedInfo.driverPhone}`} className="font-bold text-primary hover:underline">{driverAcceptedInfo.driverPhone}</a>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setShowDriverAcceptedModal(false)}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold py-3.5 rounded-2xl shadow-lg hover:opacity-90 transition-all active:scale-[0.98]">
              حسناً، شكراً
            </button>
          </div>
        </div>
      )}

      {view === "menu" && <MenuView onSelect={setView} />}
      {view === "new-order" && (
        <NewOrderView onBack={() => setView("menu")} onSuccess={() => setView("my-orders")} userId={userId} queryClient={queryClient} />
      )}
      {view === "my-orders" && (
        <MyOrdersView
          onBack={() => setView("menu")}
          userId={userId}
          onDriverArrived={(orderId) => {
            if (arrivedOrderIdRef.current !== orderId) {
              arrivedOrderIdRef.current = orderId;
              setShowArrivalModal(true);
              startArrivalLoop();
            }
          }}
          onDriverAccepted={(info) => {
            if (!acceptedOrderIdRef.current.has(info.orderId)) {
              acceptedOrderIdRef.current.add(info.orderId);
              setDriverAcceptedInfo(info);
              setShowDriverAcceptedModal(true);
            }
          }}
          queryClient={queryClient}
        />
      )}

      {/* ── Feature 5: Customer Service floating button ───────────────── */}
      <button onClick={() => openSupport()}
        className="fixed bottom-6 left-6 w-14 h-14 bg-primary text-white rounded-full flex items-center justify-center shadow-xl shadow-primary/30 hover:scale-105 active:scale-95 transition-all z-50"
        data-testid="button-support" title="تواصل مع الدعم">
        <HeadphonesIcon className="w-6 h-6" />
      </button>
    </Layout>
  );
}

// ─── Star Rating Modal ────────────────────────────────────────────────────────
interface RatingModalProps {
  orderId: string;
  raterUserId: string;
  ratedUserId: string;
  raterType: "consumer" | "driver";
  ratedName?: string;
  onClose: () => void;
  onSubmitted: () => void;
}
function RatingModal({ orderId, raterUserId, ratedUserId, raterType, ratedName, onClose, onSubmitted }: RatingModalProps) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submitRating = async () => {
    if (stars === 0) { setError("يرجى اختيار عدد النجوم"); return; }
    setLoading(true); setError("");
    try {
      await customFetch<{ id: string }>(`/api/orders/${orderId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raterUserId, ratedUserId, raterType, stars, comment: comment.trim() || undefined }),
      });
      setDone(true);
      setTimeout(() => { onSubmitted(); }, 1500);
    } catch (err: any) {
      setError(err?.data?.error || "تعذّر الإرسال، يرجى المحاولة مرة أخرى");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 mx-4 max-w-sm w-full shadow-2xl border border-primary/20 animate-in zoom-in-95 duration-300" dir="rtl">
        {done ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="font-bold text-slate-800 dark:text-white">شكراً على تقييمك!</p>
          </div>
        ) : (
          <>
            <button onClick={onClose} className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200">
              <X className="w-4 h-4" />
            </button>
            <h3 className="font-bold text-slate-800 dark:text-white mb-1 text-lg">قيّم التوصيل</h3>
            {ratedName && <p className="text-sm text-slate-500 mb-4">{ratedName}</p>}
            <div className="flex items-center justify-center gap-2 mb-5">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)} onClick={() => setStars(n)}
                  className="transition-transform hover:scale-110 active:scale-95">
                  <Star className={`w-10 h-10 ${n <= (hovered || stars) ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="أضف تعليقاً (اختياري)..."
              rows={3}
              className="w-full border border-slate-200 dark:border-slate-700 rounded-2xl p-3 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/40 bg-white dark:bg-slate-800 text-slate-800 dark:text-white mb-4"
            />
            {error && <p className="text-red-500 text-xs mb-3">{error}</p>}
            <button onClick={submitRating} disabled={loading || stars === 0}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-primary to-cyan-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:opacity-90">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Star className="w-5 h-5 fill-white" />}
              إرسال التقييم
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MenuView({ onSelect }: { onSelect: (view: View) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6 mt-8">
      <button onClick={() => onSelect("new-order")} className="bubble-card p-8 flex flex-col items-center justify-center gap-4 group" data-testid="button-nav-new-order">
        <div className="w-20 h-20 bg-gradient-to-tr from-sky-400 to-primary rounded-full flex items-center justify-center shadow-lg shadow-sky-400/40 group-hover:scale-110 transition-transform duration-300">
          <ShoppingBag className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{t("dashboard.newOrder")}</h2>
        <p className="text-slate-500 text-center max-w-[200px]">{t("dashboard.newOrderDesc")}</p>
      </button>
      <button onClick={() => onSelect("my-orders")} className="bubble-card p-8 flex flex-col items-center justify-center gap-4 group" data-testid="button-nav-my-orders">
        <div className="w-20 h-20 bg-gradient-to-tr from-teal-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-teal-400/40 group-hover:scale-110 transition-transform duration-300">
          <ListOrdered className="w-10 h-10 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">{t("dashboard.myOrders")}</h2>
        <p className="text-slate-500 text-center max-w-[200px]">{t("dashboard.myOrdersDesc")}</p>
      </button>
    </div>
  );
}

type SavedLocation = { id: string; label: string; latitude: number; longitude: number };

function NewOrderView({ onBack, onSuccess, userId, queryClient }: {
  onBack: () => void; onSuccess: () => void;
  userId: string; queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [selectedVolumes, setSelectedVolumes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "acquired">("idle");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const createOrderMutation = useCreateOrder();

  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  type TodayCount = { used: number; remaining: number; limit: number; resetsAt: string };
  const [todayCount, setTodayCount] = useState<TodayCount | null>(null);

  useEffect(() => {
    customFetch<SavedLocation[]>(`/api/locations`)
      .then(setSavedLocations)
      .catch(() => {});
    customFetch<TodayCount>("/api/orders/today-count")
      .then(setTodayCount)
      .catch(() => {});
  }, [userId]);

  const toggleVolume = (vol: string) => {
    if (selectedVolumes.includes(vol)) {
      setSelectedVolumes(prev => prev.filter(v => v !== vol));
    } else {
      if (selectedVolumes.length >= 3) return;
      setSelectedVolumes(prev => [...prev, vol]);
    }
  };

  const calculatePrice = () => {
    if (selectedVolumes.length === 0) return 0;
    return selectedVolumes.reduce((acc, vol) => acc + (PRICE_MAP[vol] ?? 0), 0);
  };

  const totalPrice = calculatePrice();

  const handleLocate = () => {
    if (!navigator.geolocation) { setError("المتصفح لا يدعم تحديد الموقع الجغرافي"); return; }
    setGpsState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsState("acquired"); setError(""); },
      () => { setGpsState("idle"); setError("تعذّر تحديد موقعك. تأكد من منح الإذن للمتصفح."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSelectSavedLocation = (loc: SavedLocation) => {
    setCoords({ lat: loc.latitude, lng: loc.longitude });
    setGpsState("acquired");
    setError("");
  };

  const handleSaveLocation = async () => {
    if (!coords || !saveLabel.trim()) return;
    setSavingLocation(true);
    try {
      const newLoc = await customFetch<SavedLocation>(`/api/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: saveLabel.trim(), latitude: coords.lat, longitude: coords.lng }),
      });
      setSavedLocations(prev => [...prev, newLoc]);
      setShowSaveForm(false);
      setSaveLabel("");
    } catch { /* silently fail */ }
    finally { setSavingLocation(false); }
  };

  const handleDeleteSavedLocation = async (locId: string) => {
    try {
      await customFetch(`/api/locations/${locId}`, { method: "DELETE" });
      setSavedLocations(prev => prev.filter(l => l.id !== locId));
    } catch { /* silently fail */ }
  };

  const handleSubmit = () => {
    if (selectedVolumes.length === 0) { setError("الرجاء اختيار حجم واحد على الأقل"); return; }
    if (!coords) { setError("الرجاء تحديد موقعك الجغرافي أولاً"); return; }
    createOrderMutation.mutate(
      { data: { userId, waterVolume: selectedVolumes.join(", "), barrelCount: 1, totalPrice, latitude: coords.lat, longitude: coords.lng } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserOrdersQueryKey(userId) });
          // Refresh today's remaining count after a successful order
          customFetch<TodayCount>("/api/orders/today-count").then(setTodayCount).catch(() => {});
          onSuccess();
        },
        onError: (err: unknown) => {
          const e = err as { data?: { error?: string; code?: string } };
          // Refresh count on 429 (limit exceeded) so badge stays accurate
          if (e?.data?.code === "DAILY_ORDER_LIMIT_EXCEEDED") {
            customFetch<TodayCount>("/api/orders/today-count").then(setTodayCount).catch(() => {});
          }
          setError(e?.data?.error || "حدث خطأ في تقديم الطلب");
        },
      }
    );
  };

  return (
    <div className="flex flex-col animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center mb-6">
        <button onClick={onBack} className="p-2 mr-[-8px] text-slate-500 hover:text-primary transition-colors">
          <ArrowRight className="w-6 h-6 ml-2" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">طلب مياه جديد</h1>
      </div>

      {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-2xl mb-4">{error}</div>}

      <div className="glass-panel rounded-3xl p-6 mb-6">
        {/* ── Saved locations dropdown ── */}
        {savedLocations.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
              <Bookmark className="w-3.5 h-3.5" />مواقعي المحفوظة
            </p>
            <div className="space-y-2">
              {savedLocations.map(loc => (
                <div key={loc.id} className="flex items-center gap-2">
                  <button
                    onClick={() => handleSelectSavedLocation(loc)}
                    className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium text-right transition-all ${
                      coords?.lat === loc.latitude && coords?.lng === loc.longitude
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:border-primary/40"
                    }`}
                  >
                    {coords?.lat === loc.latitude && coords?.lng === loc.longitude
                      ? <BookmarkCheck className="w-4 h-4 shrink-0" />
                      : <Bookmark className="w-4 h-4 shrink-0 text-slate-400" />
                    }
                    {loc.label}
                  </button>
                  <button
                    onClick={() => handleDeleteSavedLocation(loc.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="حذف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <button onClick={handleLocate} disabled={gpsState === "loading" || gpsState === "acquired"}
            className={`w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold text-base transition-all shadow-md active:scale-[0.98] ${
              gpsState === "acquired"
                ? "bg-emerald-500 text-white shadow-emerald-500/20 cursor-default"
                : "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border-2 border-sky-300 dark:border-sky-700 hover:bg-sky-200"
            }`} data-testid="button-locate">
            {gpsState === "loading" ? <Loader2 className="w-5 h-5 animate-spin" /> : <MapPin className="w-5 h-5" />}
            {gpsState === "acquired" ? "تم تحديد موقعك بدقة ✔" : gpsState === "loading" ? "جاري تحديد الموقع..." : "تحديد موقع منزلي تلقائياً"}
          </button>
          {coords && <p className="text-xs text-slate-400 text-center mt-2">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</p>}
        </div>

        {/* ── Save current GPS location ── */}
        {gpsState === "acquired" && coords && !savedLocations.some(l => l.latitude === coords.lat && l.longitude === coords.lng) && (
          <div className="mb-5">
            {showSaveForm ? (
              <div className="flex gap-2 items-center">
                <input
                  value={saveLabel}
                  onChange={e => setSaveLabel(e.target.value)}
                  placeholder="اسم الموقع (مثال: منزلي)"
                  className="flex-1 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  dir="rtl"
                />
                <button
                  onClick={handleSaveLocation}
                  disabled={!saveLabel.trim() || savingLocation}
                  className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1"
                >
                  {savingLocation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookmarkCheck className="w-3.5 h-3.5" />}
                  حفظ
                </button>
                <button onClick={() => { setShowSaveForm(false); setSaveLabel(""); }} className="p-2 rounded-xl text-slate-400 hover:text-slate-600">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => setShowSaveForm(true)}
                className="w-full py-2 rounded-xl flex items-center justify-center gap-2 text-sm text-primary border border-primary/30 hover:bg-primary/5 transition-colors font-medium">
                <Bookmark className="w-4 h-4" />حفظ هذا الموقع للمرات القادمة
              </button>
            )}
          </div>
        )}


        {/* ── Daily order quota badge ── */}
        {todayCount !== null && (
          <div className={`flex items-center justify-between px-4 py-2.5 rounded-2xl mb-4 text-sm font-medium border ${
            todayCount.remaining === 0
              ? "bg-destructive/10 border-destructive/30 text-destructive"
              : todayCount.remaining === 1
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
              : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
          }`} dir="rtl">
            <span>الطلبات المتبقية اليوم: <span className="font-bold">{todayCount.remaining} من {todayCount.limit}</span></span>
            {todayCount.remaining === 0 && (
              <span className="text-xs opacity-80">تجدد بعد منتصف الليل</span>
            )}
          </div>
        )}

        {todayCount?.remaining === 0 && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-2xl mb-4 text-right leading-relaxed">
            لقد استنفدت الحد الأقصى لطلبات اليوم (3 طلبات). يمكنك تقديم طلبات جديدة بعد منتصف الليل.
          </div>
        )}

        <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Droplet className="w-5 h-5 text-primary" />اختر الحجم (اختر حتى 3)</h3>
        <div className="flex flex-wrap gap-2 mb-6">
          {VOLUMES.map(vol => (
            <button key={vol} onClick={() => toggleVolume(vol)}
              className={`px-4 py-2 rounded-xl border-2 transition-all font-medium ${
                selectedVolumes.includes(vol)
                  ? "bg-primary border-primary text-white shadow-md shadow-primary/20"
                  : "bg-white/50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-primary/40"
              } ${selectedVolumes.length >= 3 && !selectedVolumes.includes(vol) ? "opacity-50 cursor-not-allowed" : ""}`}
              data-testid={`volume-${vol}`}>{vol}</button>
          ))}
        </div>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 flex justify-between items-center mb-6 border border-slate-100 dark:border-slate-800">
          <span className="text-slate-500 font-medium">السعر الإجمالي:</span>
          <span className="text-2xl font-bold text-primary" data-testid="text-total-price">{totalPrice} دج</span>
        </div>

        <button
          onClick={handleSubmit}
          disabled={createOrderMutation.isPending || selectedVolumes.length === 0 || !coords || todayCount?.remaining === 0}
          className="w-full bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/90 hover:to-cyan-500/90 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/30 disabled:opacity-50"
          data-testid="button-submit-order">
          {createOrderMutation.isPending
            ? <Loader2 className="w-6 h-6 animate-spin" />
            : <><CheckCircle2 className="w-5 h-5" /><span>إتمام الطلب</span></>}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveDriverMap — consumer-side live tracking
//
// • Fetches the driver's current position from driver_locations on mount
// • Subscribes to Supabase Realtime postgres_changes (UPDATE events) filtered
//   to this driver's row so the marker moves without polling
// • Unsubscribes automatically when the component unmounts (order delivered /
//   navigated away)
// ─────────────────────────────────────────────────────────────────────────────
function LiveDriverMap({
  driverId,
  destLat,
  destLng,
  orderId,
}: {
  driverId: string;
  /** Delivery address latitude — shown as the red "destination" pin */
  destLat: number;
  /** Delivery address longitude */
  destLng: number;
  orderId: string;
}) {
  const mapRef          = useRef<HTMLDivElement>(null);
  const mapInstanceRef  = useRef<unknown>(null);
  const driverMarkerRef = useRef<unknown>(null);
  const polylineRef     = useRef<unknown>(null);
  const channelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
      polyline: (latlngs: [number, number][], opts?: object) => {
        addTo: (m: unknown) => unknown;
        setLatLngs: (latlngs: [number, number][]) => void;
      };
    };

    const initMap = async (L: LeafletType) => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = L.map(mapRef.current!, { zoomControl: true, attributionControl: false });
      mapInstanceRef.current = map;
      map.setView([destLat, destLng], 15);

      // Satellite tile layer (Esri World Imagery — free, no API key)
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "© Esri, Maxar, Earthstar Geographics" }
      ).addTo(map);

      // Destination marker (red pin)
      const destIcon = L.divIcon({
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#ef4444;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.5)"></div>`,
        className: "",
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([destLat, destLng], { icon: destIcon }).addTo(map).bindPopup("📍 موقع التوصيل");

      // Driver icon (blue pulsing dot)
      const driverIcon = L.divIcon({
        html: `<div style="position:relative;width:24px;height:24px">
          <div style="position:absolute;inset:0;border-radius:50%;background:#0ea5e9;opacity:0.3;animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite"></div>
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:#0ea5e9;border:2px solid white;box-shadow:0 2px 8px rgba(14,165,233,0.7)"></div>
        </div>`,
        className: "",
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      // Inject ping keyframe once
      if (!document.getElementById("driver-ping-style")) {
        const style = document.createElement("style");
        style.id = "driver-ping-style";
        style.textContent = `@keyframes ping{75%,100%{transform:scale(2.5);opacity:0}}`;
        document.head.appendChild(style);
      }

      const placeOrMoveDriver = (lat: number, lng: number) => {
        const latLng: [number, number] = [lat, lng];
        if (!driverMarkerRef.current) {
          driverMarkerRef.current = L.marker(latLng, { icon: driverIcon })
            .addTo(map)
            .bindPopup("🚚 موقع السائق");
          polylineRef.current = L.polyline([latLng, [destLat, destLng]], {
            color: "#0ea5e9", weight: 4, opacity: 0.85, dashArray: "10, 6",
          }).addTo(map);
          (map as unknown as { fitBounds: (b: [[number,number],[number,number]], opts: object) => void })
            .fitBounds([[lat, lng], [destLat, destLng]], { padding: [50, 50] });
        } else {
          (driverMarkerRef.current as { setLatLng: (c: [number, number]) => void }).setLatLng(latLng);
          if (polylineRef.current) {
            (polylineRef.current as { setLatLngs: (c: [number, number][]) => void })
              .setLatLngs([latLng, [destLat, destLng]]);
          }
        }
      };

      // Await boot-time setSession() before subscribing so postgres_changes
      // is opened with the user's real JWT rather than the anonymous role.
      // On a fresh login this resolves immediately (no pending boot promise).
      await getSessionBootReady().catch(() => {/* non-fatal; proceed anyway */});

      // Initial position — fetch current row from driver_locations
      supabase
        .from("driver_locations")
        .select("latitude, longitude")
        .eq("driver_id", driverId)
        .single()
        .then(({ data }) => {
          if (data) placeOrMoveDriver(data.latitude as number, data.longitude as number);
        });

      // Realtime subscription — move marker on INSERT or UPDATE.
      // We listen to "*" (all events) so we catch both:
      //   INSERT — first time the driver row is created during a delivery
      //   UPDATE — every subsequent position update
      // Typed as `any` because the Supabase JS v2 overloaded `.on()` signature
      // doesn't narrow cleanly for "postgres_changes" without importing its
      // internal enum; consistent with the rest of this codebase's approach.
      const handleLocationPayload = (payload: { new: Record<string, unknown> }) => {
        const { latitude, longitude } = payload.new;
        if (typeof latitude === "number" && typeof longitude === "number") {
          placeOrMoveDriver(latitude, longitude);
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channel = (supabase.channel(`consumer-driver-loc-${orderId}`) as any)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "driver_locations",
            filter: `driver_id=eq.${driverId}`,
          },
          handleLocationPayload
        )
        .subscribe();

      channelRef.current = channel;
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
      await initMap(win["L"] as LeafletType);
    };

    loadLeaflet();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove: () => void }).remove();
        mapInstanceRef.current = null;
      }
      driverMarkerRef.current = null;
      polylineRef.current = null;
    };
  }, [orderId, driverId, destLat, destLng]);

  return (
    <div className="mt-3">
      <p className="text-xs text-sky-500 font-semibold mb-1.5 flex items-center gap-1">
        <Truck className="w-3 h-3" /> موقع السائق الحي
      </p>
      <div
        ref={mapRef}
        className="w-full rounded-2xl overflow-hidden border border-sky-200 dark:border-sky-800"
        style={{ height: "200px" }}
      />
    </div>
  );
}

function MyOrdersView({ onBack, userId, onDriverArrived, onDriverAccepted, queryClient }: {
  onBack: () => void;
  userId: string;
  onDriverArrived: (orderId: string) => void;
  onDriverAccepted: (info: DriverAcceptedInfo) => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  // Cross-network real-time: invalidates orders cache on driver status changes via Supabase Realtime.
  // Falls back to the 5-second poll transparently when WebSocket is unavailable.
  useRealtimeOrderStatus(userId);

  const { data: orders, isLoading } = useGetUserOrders(userId, {
    query: {
      enabled: !!userId,
      queryKey: getGetUserOrdersQueryKey(userId),
      refetchInterval: 5000,
    },
  });

  const cancelMutation = useCancelOrder();
  const notifiedArrivalRef = useRef<Set<string>>(new Set());
  const notifiedAcceptedRef = useRef<Set<string>>(new Set());

  const [ratingModal, setRatingModal] = useState<{ orderId: string; driverId: string } | null>(null);
  const [ratedOrders, setRatedOrders] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem("rated_orders_consumer") || "[]")); }
    catch { return new Set<string>(); }
  });

  const checkEvents = useCallback(() => {
    if (!orders) return;
    for (const order of orders) {
      if (order.status === "وصل السائق" && !notifiedArrivalRef.current.has(order.id)) {
        notifiedArrivalRef.current.add(order.id);
        onDriverArrived(order.id);
      }
      if (
        order.status === "قيد التوصيل" &&
        order.driverId &&
        !notifiedAcceptedRef.current.has(order.id)
      ) {
        notifiedAcceptedRef.current.add(order.id);
        onDriverAccepted({
          orderId: order.id,
          driverName: (order as any).driverName ?? null,
          driverPhone: (order as any).driverPhone ?? null,
        });
      }
    }
  }, [orders, onDriverArrived, onDriverAccepted]);

  useEffect(() => { checkEvents(); }, [checkEvents]);

  const handleCancel = (orderId: string) => {
    cancelMutation.mutate({ orderId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetUserOrdersQueryKey(userId) }),
    });
  };

  const markRated = (orderId: string) => {
    const next = new Set(ratedOrders);
    next.add(orderId);
    setRatedOrders(next);
    try { localStorage.setItem("rated_orders_consumer", JSON.stringify([...next])); } catch { /* ignore */ }
    setRatingModal(null);
  };

  return (
    <div className="flex flex-col animate-in slide-in-from-bottom-4 duration-300 h-full">
      {ratingModal && (
        <RatingModal
          orderId={ratingModal.orderId}
          raterUserId={userId}
          ratedUserId={ratingModal.driverId}
          raterType="consumer"
          ratedName="السائق"
          onClose={() => setRatingModal(null)}
          onSubmitted={() => markRated(ratingModal.orderId)}
        />
      )}
      <div className="flex items-center mb-6">
        <button onClick={onBack} className="p-2 mr-[-8px] text-slate-500 hover:text-primary transition-colors">
          <ArrowRight className="w-6 h-6 ml-2" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-white">طلباتي</h1>
        <span className="mr-2 text-xs text-slate-400">(يتحدث تلقائياً)</span>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-primary">
          <Loader2 className="w-10 h-10 animate-spin mb-4" /><p>جاري تحميل الطلبات...</p>
        </div>
      ) : !orders || orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 glass-panel rounded-3xl">
          <ShoppingBag className="w-16 h-16 mb-4 opacity-50" /><p className="text-lg">لا توجد طلبات سابقة</p>
        </div>
      ) : (
        <div className="space-y-4 pb-10">
          {orders.map(order => (
            <div key={order.id}
              className={`glass-panel p-5 rounded-3xl border-2 transition-all ${
                order.status === "وصل السائق"
                  ? "border-amber-400 shadow-amber-200 dark:shadow-amber-900/30 shadow-lg"
                  : "border-transparent"
              }`} data-testid={`order-card-${order.id}`}>
              <div className="flex justify-between items-start mb-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex flex-col">
                  <span className="font-bold text-lg text-slate-800 dark:text-white">{order.waterVolume}</span>
                  <span className="text-xs text-slate-400">{format(new Date(order.createdAt), "dd/MM/yyyy HH:mm")}</span>
                </div>
                <div className="text-lg font-bold text-primary">{order.totalPrice} دج</div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  {order.status === "معلق" && (
                    <div className="flex items-center gap-1.5 text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full text-sm font-medium">
                      <Clock className="w-4 h-4" /><span>معلق — بانتظار السائق</span>
                    </div>
                  )}
                  {order.status === "قيد التوصيل" && (
                    <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-full text-sm font-medium animate-pulse">
                      <Truck className="w-4 h-4" /><span>قيد التوصيل</span>
                    </div>
                  )}
                  {order.status === "وصل السائق" && (
                    <div className="flex items-center gap-1.5 text-orange-600 bg-orange-50 dark:bg-orange-900/20 px-3 py-1.5 rounded-full text-sm font-bold">
                      <Bell className="w-4 h-4 animate-bounce" /><span>وصل السائق!</span>
                    </div>
                  )}
                  {order.status === "تم التوصيل" && (
                    <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-full text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4" /><span>تم التوصيل ✔</span>
                    </div>
                  )}
                  {order.status === "تم التوصيل" && order.driverId && !ratedOrders.has(order.id) && (
                    <button
                      onClick={() => setRatingModal({ orderId: order.id, driverId: order.driverId! })}
                      className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 px-3 py-1.5 rounded-full transition-colors font-medium"
                    >
                      <Star className="w-3 h-3 fill-amber-500 text-amber-500" />قيّم التوصيل
                    </button>
                  )}
                  {order.status === "تم التوصيل" && ratedOrders.has(order.id) && (
                    <div className="flex items-center gap-1 text-xs text-slate-400 px-3 py-1.5">
                      <Star className="w-3 h-3 fill-slate-300 text-slate-300" />تم التقييم
                    </div>
                  )}
                  {order.status === "ملغى" && (
                    <div className="flex items-center gap-1.5 text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-full text-sm font-medium">
                      <XCircle className="w-4 h-4" /><span>ملغى</span>
                    </div>
                  )}
                </div>
                {order.status === "معلق" && (
                  <button
                    onClick={() => handleCancel(order.id)}
                    disabled={cancelMutation.isPending}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 px-3 py-1.5 rounded-full transition-colors font-medium"
                    data-testid={`button-cancel-${order.id}`}
                  >
                    {cancelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                    إلغاء الطلبية
                  </button>
                )}
              </div>

              {/* Live driver map — visible only while the driver is en-route */}
              {order.status === "قيد التوصيل" && order.driverId && order.latitude && order.longitude && (
                <LiveDriverMap
                  driverId={order.driverId}
                  destLat={Number(order.latitude)}
                  destLng={Number(order.longitude)}
                  orderId={order.id}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
