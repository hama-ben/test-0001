/**
 * SupportChatModal
 *
 * Full two-way chat interface between the user and the Mizu support team.
 * Replaces the one-shot CustomerServiceModal for logged-in users.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Send, Loader2, HeadphonesIcon, ExternalLink,
  MessageCircle, RefreshCw,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import { setLastViewed, type SupportMessage } from "@/hooks/use-support-unread";
import { getSocket } from "@/lib/socket-client";

const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61590856328769";

interface SupportChatModalProps {
  userId: string;
  userName: string;
  onClose: () => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ar-DZ", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ar-DZ", {
      day: "numeric",
      month: "long",
    });
  } catch {
    return "";
  }
}

export function SupportChatModal({ userId, userName, onClose }: SupportChatModalProps) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const [sendError, setSendError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  };

  const fetchThread = useCallback(async () => {
    try {
      setError("");
      const data = await customFetch<{ messages: SupportMessage[] }>("/api/support/thread");
      setMessages(data?.messages ?? []);
      scrollToBottom();
    } catch {
      setError("تعذّر تحميل المحادثة. تحقق من اتصالك وأعد المحاولة.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load thread and mark as viewed on mount
  useEffect(() => {
    fetchThread();
    setLastViewed(userId);
  }, [fetchThread, userId]);

  // Realtime subscription — new messages appear instantly
  useEffect(() => {
    const channel = supabase
      .channel(`support-chat-${userId}`)
      .on(
        "postgres_changes" as Parameters<ReturnType<typeof supabase.channel>["on"]>[0],
        {
          event:  "INSERT",
          schema: "public",
          table:  "support_messages",
          filter: `user_id=eq.${userId}`,
        } as any,
        (payload: any) => {
          const newMsg = payload.new as SupportMessage;
          setMessages((prev) => {
            if (prev.find((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setLastViewed(userId);
          scrollToBottom();
        }
      )
      .subscribe();

    return () => { try { supabase.removeChannel(channel); } catch { /* ignore */ } };
  }, [userId]);

  // Socket.io fast-path — catches admin replies pushed via emitToUser()
  // before Supabase Realtime postgres_changes fires (typically ~100ms faster).
  useEffect(() => {
    const socket = getSocket();
    const handleReply = (data: { message?: SupportMessage }) => {
      const msg = data?.message;
      if (!msg) return;
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setLastViewed(userId);
      scrollToBottom();
    };
    socket.on("support_reply", handleReply);
    return () => { socket.off("support_reply", handleReply); };
  }, [userId]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setSendError("");
    try {
      const data = await customFetch<{ message: SupportMessage }>("/api/support/thread/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: trimmed }),
      });
      setText("");
      if (data?.message) {
        setMessages((prev) => {
          if (prev.find((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
        setLastViewed(userId);
        scrollToBottom();
      }
    } catch {
      setSendError("تعذّر إرسال الرسالة. حاول مرة أخرى.");
    } finally {
      setSending(false);
    }
  };

  // Group messages by date
  const grouped: { date: string; msgs: SupportMessage[] }[] = [];
  messages.forEach((m) => {
    const d = formatDate(m.createdAt);
    const last = grouped[grouped.length - 1];
    if (last && last.date === d) {
      last.msgs.push(m);
    } else {
      grouped.push({ date: d, msgs: [m] });
    }
  });

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      dir="rtl"
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl border border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300 flex flex-col"
        style={{ maxHeight: "90dvh", height: "600px" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 p-5 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="w-11 h-11 bg-gradient-to-br from-primary to-cyan-500 rounded-2xl flex items-center justify-center shrink-0">
            <HeadphonesIcon className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-slate-800 dark:text-white">الدعم الفني</h2>
            <p className="text-xs text-slate-400 truncate">فريق ميزو جاهز للمساعدة</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Facebook fallback ── */}
        <div className="px-4 pt-3 pb-1 shrink-0">
          <a
            href={FACEBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-2 rounded-2xl text-xs font-bold bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            صفحتنا الرسمية على فيسبوك
          </a>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm text-slate-500 text-center">{error}</p>
              <button
                onClick={fetchThread}
                className="flex items-center gap-1.5 text-xs text-primary font-bold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                إعادة المحاولة
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                <MessageCircle className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">ابدأ المحادثة</p>
                <p className="text-xs text-slate-400 mt-0.5">اكتب رسالتك وسيرد فريق الدعم قريباً</p>
              </div>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.date}>
                {/* Date divider */}
                <div className="flex items-center gap-2 my-2">
                  <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                  <span className="text-[10px] text-slate-400 font-medium px-2">{group.date}</span>
                  <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                </div>

                <div className="space-y-2">
                  {group.msgs.map((msg) => {
                    const isUser = msg.senderType === "user";
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}
                      >
                        {!isUser && (
                          <span className="text-[10px] text-slate-400 font-medium px-1">
                            ميزو — الدعم الفني
                          </span>
                        )}
                        <div
                          className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isUser
                              ? "bg-primary text-white rounded-tl-sm"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white rounded-tr-sm"
                          }`}
                        >
                          {msg.message}
                        </div>
                        <span className="text-[10px] text-slate-400 px-1">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── Input ── */}
        <form
          onSubmit={handleSend}
          className="p-4 border-t border-slate-100 dark:border-slate-800 shrink-0"
        >
          {sendError && (
            <p className="text-xs text-red-500 mb-2 text-center">{sendError}</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e as any);
                }
              }}
              placeholder="اكتب رسالتك..."
              rows={1}
              maxLength={1000}
              className="flex-1 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/40 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white placeholder-slate-400 leading-relaxed"
              style={{ maxHeight: "120px", overflowY: "auto" }}
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="w-11 h-11 rounded-2xl flex items-center justify-center bg-primary text-white shadow-md shadow-primary/25 hover:opacity-90 transition-all active:scale-[0.95] disabled:opacity-40 shrink-0"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
