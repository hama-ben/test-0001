import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, X, Megaphone, Check } from "lucide-react";
import type { Announcement } from "@/hooks/use-announcements";

const AUTO_EXPIRE_MS = 15_000;

function formatRelativeArabic(dateStr: string): string {
  const diffMs    = Date.now() - new Date(dateStr).getTime();
  const diffSecs  = Math.floor(diffMs / 1000);
  const diffMins  = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);

  if (diffSecs < 60)   return "الآن";
  if (diffMins < 60)   return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24)  return `منذ ${diffHours} ساعة`;
  if (diffDays === 1)  return "أمس";
  if (diffDays < 7)    return `منذ ${diffDays} أيام`;
  return new Date(dateStr).toLocaleDateString("ar-DZ");
}

/** Splits a string on URLs and returns a mix of text and <a> elements. */
function ContentWithLinks({ text }: { text: string }) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return (
    <>
      {parts.map((part, i) =>
        urlRegex.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline font-bold text-[11px] break-all"
          >
            اضغط هنا للتواصل →
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

interface AnnouncementsPanelProps {
  isOpen:        boolean;
  onClose:       () => void;
  announcements: Announcement[];
  onDismiss:     (id: string) => void;
}

export function AnnouncementsPanel({ isOpen, onClose, announcements, onDismiss }: AnnouncementsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Track which IDs are currently in their 300ms fade-out animation
  const [fadingOut, setFadingOut] = useState<Set<string>>(new Set());
  // Track timers per announcement so we can cancel on manual dismiss
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /** Trigger the fade-out animation then call onDismiss */
  const handleDismiss = useCallback((id: string) => {
    // Cancel any pending auto-expire timer for this card
    const existing = timersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(id);
    }
    // Start fade-out animation
    setFadingOut(prev => new Set(prev).add(id));
    setTimeout(() => {
      onDismiss(id);
      setFadingOut(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  }, [onDismiss]);

  // Auto-expire: start 15s timers for unread announcements when panel opens
  useEffect(() => {
    if (!isOpen) {
      // Clean up all timers when panel closes
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current.clear();
      return;
    }

    const unread = announcements.filter(a => !a.isRead);
    unread.forEach(ann => {
      if (timersRef.current.has(ann.id)) return; // already started
      const t = setTimeout(() => {
        timersRef.current.delete(ann.id);
        handleDismiss(ann.id);
      }, AUTO_EXPIRE_MS);
      timersRef.current.set(ann.id, t);
    });

    // Cleanup timers for IDs that are no longer in announcements
    return () => {
      // intentionally don't clear here — let the close handler do it
    };
  }, [isOpen, announcements, handleDismiss]);

  // Click-outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        ref={panelRef}
        className="pointer-events-auto absolute top-16 left-0 right-0 sm:left-auto sm:right-4 sm:w-[380px] mx-2 sm:mx-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2 duration-200"
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary/10 rounded-xl flex items-center justify-center">
              <Bell className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-slate-800 dark:text-white text-sm">الإعلانات</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto max-h-[60vh]">
          {announcements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400 dark:text-slate-500">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Bell className="w-7 h-7 opacity-40" />
              </div>
              <p className="text-sm font-medium">لا توجد إعلانات حالياً</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {announcements.map(ann => (
                <div
                  key={ann.id}
                  style={{ transition: "opacity 300ms ease, max-height 300ms ease" }}
                  className={`px-4 py-3 flex items-start gap-3 transition-all ${
                    fadingOut.has(ann.id) ? "opacity-0" : "opacity-100"
                  } ${
                    !ann.isRead
                      ? "bg-primary/5 dark:bg-primary/10"
                      : "bg-white dark:bg-slate-900"
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      !ann.isRead
                        ? "bg-primary/15 dark:bg-primary/20"
                        : "bg-slate-100 dark:bg-slate-800"
                    }`}
                  >
                    <Megaphone
                      className={`w-4 h-4 ${!ann.isRead ? "text-primary" : "text-slate-400"}`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`font-bold text-sm leading-snug ${
                          !ann.isRead ? "text-primary" : "text-slate-800 dark:text-white"
                        }`}
                      >
                        {ann.title}
                      </span>
                      {!ann.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                      <ContentWithLinks text={ann.content} />
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[10px] text-slate-400">
                        {formatRelativeArabic(ann.createdAt)}
                      </p>
                      {/* Dismiss button */}
                      <button
                        onClick={() => handleDismiss(ann.id)}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-primary dark:hover:text-primary transition-colors px-2 py-0.5 rounded-lg hover:bg-primary/10"
                        aria-label="إخفاء"
                      >
                        <Check className="w-3 h-3" />
                        إخفاء
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
