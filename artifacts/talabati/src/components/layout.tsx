import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, Sun, Moon, UserCircle, Bell, HeadphonesIcon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useTranslation, LOCALES, LOCALE_FLAGS, type Locale } from "@/lib/i18n";
import { useDriverOrderWatcher } from "@/hooks/use-driver-order-watcher";
import { useOrderNotificationStore } from "@/stores/order-notifications";
import { useSocketConnection } from "@/hooks/use-socket-connection";
import { useAnnouncements } from "@/hooks/use-announcements";
import { AnnouncementsPanel } from "@/components/announcements-panel";
import { useSupportChatStore } from "@/stores/support-chat";
import { useSupportUnread } from "@/hooks/use-support-unread";
import { SupportChatModal } from "@/components/support-chat-modal";

export function WaterDrops() {
  return (
    <div className="water-drops-container" aria-hidden="true">
      {Array.from({ length: 15 }).map((_, i) => (
        <div key={i} className="water-drop" />
      ))}
    </div>
  );
}

export function WaterTruckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="18" width="78" height="22" rx="3" fill="currentColor" opacity="0.85" />
      <rect x="2" y="10" width="22" height="14" rx="2" fill="currentColor" />
      <rect x="26" y="14" width="16" height="10" rx="2" fill="currentColor" opacity="0.9" />
      <rect x="44" y="14" width="16" height="10" rx="2" fill="currentColor" opacity="0.9" />
      <rect x="62" y="14" width="16" height="10" rx="2" fill="currentColor" opacity="0.9" />
      <rect x="4" y="12" width="18" height="10" rx="1.5" fill="white" opacity="0.25" />
      <circle cx="14" cy="42" r="5" fill="white" stroke="currentColor" strokeWidth="2" />
      <circle cx="14" cy="42" r="2" fill="currentColor" />
      <circle cx="64" cy="42" r="5" fill="white" stroke="currentColor" strokeWidth="2" />
      <circle cx="64" cy="42" r="2" fill="currentColor" />
      <circle cx="48" cy="42" r="5" fill="white" stroke="currentColor" strokeWidth="2" />
      <circle cx="48" cy="42" r="2" fill="currentColor" />
      <rect x="6" y="20" width="4" height="2" rx="1" fill="white" opacity="0.5" />
    </svg>
  );
}

function LanguageCycleButton() {
  const { locale, setLocale } = useTranslation();

  const cycleLocale = () => {
    const idx = LOCALES.indexOf(locale);
    const next = LOCALES[(idx + 1) % LOCALES.length] as Locale;
    setLocale(next);
  };

  return (
    <button
      onClick={cycleLocale}
      title={`Language: ${locale.toUpperCase()}`}
      className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition-colors text-base leading-none select-none"
      aria-label="Switch language"
    >
      {LOCALE_FLAGS[locale]}
    </button>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <button
      onClick={toggleTheme}
      title={theme === "dark" ? t("theme.light") : t("theme.dark")}
      className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-600 dark:text-slate-300"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export function AuthControls() {
  return (
    <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
      <LanguageCycleButton />
      <ThemeToggleButton />
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { name, userId, userType, logout } = useAuth();
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const isDriver = userType === "سائق" && !!userId;
  const announcementUserType = isDriver ? "driver" : "customer";

  useDriverOrderWatcher(isDriver);
  useSocketConnection(userId ?? null, isDriver);

  const notifCount = useOrderNotificationStore((s) => s.count);
  const resetNotif = useOrderNotificationStore((s) => s.reset);

  const { announcements, unreadCount, dismissAnnouncement } = useAnnouncements(
    userId ?? null,
    announcementUserType
  );

  const [panelOpen, setPanelOpen] = useState(false);

  // Support chat
  const { isOpen: supportOpen, open: openSupport, close: closeSupport } = useSupportChatStore();
  const { hasUnread, latestAdminMsgId, markViewed, refetch: refetchUnread } = useSupportUnread(userId ?? null);
  const autoOpenedForRef = useRef<string | null>(null);

  const handleSupportOpen = () => {
    markViewed();
    openSupport();
  };

  // Auto-open chat when there is a new unread admin reply
  useEffect(() => {
    if (!hasUnread || !latestAdminMsgId) return;
    if (supportOpen) return;
    if (autoOpenedForRef.current === latestAdminMsgId) return;
    autoOpenedForRef.current = latestAdminMsgId;
    openSupport();
  }, [hasUnread, latestAdminMsgId, supportOpen, openSupport]);

  // Re-check unread when support chat closes
  useEffect(() => {
    if (!supportOpen) {
      refetchUnread();
    }
  }, [supportOpen]);

  // Reset driver order notifications when panel opens
  useEffect(() => {
    if (panelOpen) {
      resetNotif();
    }
  }, [panelOpen]);

  const handleBellClick = () => setPanelOpen(true);

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  // Total badge = unread announcements + pending order notifications (drivers)
  const totalBadge = unreadCount + (isDriver ? notifCount : 0);

  return (
    <div className="min-h-[100dvh] flex flex-col w-full relative">
      <WaterDrops />
      <header className="sticky top-0 z-50 glass-panel border-b-0 border-white/20">
        <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <WaterTruckIcon className="w-7 h-5 text-primary" />
            </div>
            <span className="font-bold text-lg text-primary tracking-tight">Mizu</span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageCycleButton />
            <ThemeToggleButton />

            {name && (
              <>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 hidden sm:block">
                  {t("nav.greeting")}، {name}
                </span>

                {/* Support chat button */}
                <button
                  onClick={handleSupportOpen}
                  className="relative w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-600 dark:text-slate-300"
                  title="الدعم الفني"
                  aria-label="الدعم الفني"
                >
                  <HeadphonesIcon className={`w-4 h-4 ${hasUnread ? "text-primary" : ""}`} />
                  {hasUnread && (
                    <span className="absolute -top-1 -right-1 w-[10px] h-[10px] rounded-full bg-red-500 shadow-md" />
                  )}
                </button>

                {/* Announcements bell — visible to all logged-in users */}
                <button
                  onClick={handleBellClick}
                  className="relative w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-600 dark:text-slate-300"
                  title="الإعلانات"
                  aria-label="الإعلانات"
                >
                  <Bell
                    className={`w-4 h-4 ${totalBadge > 0 ? "text-primary animate-bounce" : ""}`}
                  />
                  {totalBadge > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center leading-none shadow-md">
                      {totalBadge > 99 ? "99+" : totalBadge}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setLocation("/profile")}
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-600 dark:text-slate-300"
                  title="الملف الشخصي"
                  data-testid="button-profile"
                >
                  <UserCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={handleLogout}
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center transition-colors text-slate-600 dark:text-slate-300"
                  data-testid="button-logout"
                  title={t("nav.logout")}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto p-4 pb-20 flex flex-col relative z-10">
        {children}
      </main>

      {/* Announcements panel — rendered outside main so it can overlay everything */}
      <AnnouncementsPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        announcements={announcements}
        onDismiss={dismissAnnouncement}
      />

      {/* Support chat modal — globally controlled via store */}
      {supportOpen && userId && (
        <SupportChatModal
          userId={userId}
          userName={name ?? ""}
          onClose={closeSupport}
        />
      )}
    </div>
  );
}
