/**
 * NotificationSoundSettings
 *
 * Reusable settings panel for choosing a notification ringtone.
 * Used in both driver and consumer profile pages.
 * Supports 5 built-in synthesized tones + custom file upload.
 * Preference is saved to localStorage under `storageKey`.
 */

import { useState, useRef, useEffect } from "react";
import { Volume2, Upload, Play, Check } from "lucide-react";
import {
  SOUND_PRESETS,
  playPreset,
  playCustomSound,
  type SoundPresetId,
} from "@/hooks/use-notification-sound";

interface NotificationSoundSettingsProps {
  storageKey: string;
  title?: string;
  description?: string;
}

export function NotificationSoundSettings({
  storageKey,
  title = "صوت الإشعارات",
  description = "اختر نغمة الإشعار",
}: NotificationSoundSettingsProps) {
  const [selected, setSelected] = useState<SoundPresetId>("default");
  const [customName, setCustomName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey) as SoundPresetId | null;
      if (stored) setSelected(stored);
      const customData = localStorage.getItem(`${storageKey}_custom`);
      const customLabel = localStorage.getItem(`${storageKey}_custom_name`);
      if (customData && customLabel) setCustomName(customLabel);
    } catch {}
  }, [storageKey]);

  const handleSelect = (id: SoundPresetId) => {
    setSelected(id);
    // Clear custom when a preset is chosen
    setSaved(false);
  };

  const handlePreview = (id: SoundPresetId) => {
    playPreset(id);
  };

  const handlePreviewCustom = () => {
    const customData = localStorage.getItem(`${storageKey}_custom`);
    if (customData) playCustomSound(customData);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      alert("يرجى اختيار ملف صوتي صالح (MP3، WAV، OGG...)");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("حجم الملف الصوتي يجب ألا يتجاوز 5 ميغابايت");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      try {
        localStorage.setItem(`${storageKey}_custom`, dataUrl);
        localStorage.setItem(`${storageKey}_custom_name`, file.name);
        setCustomName(file.name);
        setSelected("silent"); // custom mode — deselect presets
        setSaved(false);
      } catch {
        alert("تعذّر حفظ الملف الصوتي محلياً. قد تكون ذاكرة المتصفح ممتلئة.");
      }
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSave = () => {
    try {
      if (customName && selected === "silent") {
        // custom file is already saved; just mark as saved
      } else {
        localStorage.setItem(storageKey, selected);
        // Remove custom if a preset was explicitly chosen
        localStorage.removeItem(`${storageKey}_custom`);
        localStorage.removeItem(`${storageKey}_custom_name`);
        setCustomName(null);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
  };

  const handleRemoveCustom = () => {
    try {
      localStorage.removeItem(`${storageKey}_custom`);
      localStorage.removeItem(`${storageKey}_custom_name`);
      setCustomName(null);
      setSelected("default");
    } catch {}
  };

  return (
    <div className="glass-panel rounded-3xl p-6 border border-slate-100 dark:border-slate-800" dir="rtl">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-violet-50 dark:bg-violet-900/20 rounded-xl flex items-center justify-center">
          <Volume2 className="w-5 h-5 text-violet-600" />
        </div>
        <div>
          <h2 className="font-bold text-slate-800 dark:text-white">{title}</h2>
          <p className="text-xs text-slate-400">{description}</p>
        </div>
      </div>

      {/* Built-in presets */}
      <div className="space-y-2 mb-4">
        {SOUND_PRESETS.map((preset) => (
          <div
            key={preset.id}
            className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all cursor-pointer ${
              selected === preset.id && !customName
                ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20"
                : "border-transparent bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            onClick={() => handleSelect(preset.id)}
          >
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
              selected === preset.id && !customName
                ? "border-violet-500 bg-violet-500"
                : "border-slate-300 dark:border-slate-600"
            }`}>
              {selected === preset.id && !customName && (
                <div className="w-2 h-2 rounded-full bg-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-white">{preset.label}</p>
              <p className="text-xs text-slate-400">{preset.description}</p>
            </div>
            {preset.id !== "silent" && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handlePreview(preset.id); }}
                className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 hover:bg-violet-200 transition-colors shrink-0"
                title="معاينة"
              >
                <Play className="w-3.5 h-3.5 fill-violet-600" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Custom upload */}
      <div className={`rounded-2xl border-2 border-dashed p-4 mb-5 transition-all ${
        customName ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20" : "border-slate-200 dark:border-slate-700"
      }`}>
        {customName ? (
          <div className="flex items-center gap-3">
            <Volume2 className="w-5 h-5 text-violet-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{customName}</p>
              <p className="text-xs text-slate-400">ملف مخصص</p>
            </div>
            <button
              type="button"
              onClick={handlePreviewCustom}
              className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 hover:bg-violet-200 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-violet-600" />
            </button>
            <button
              type="button"
              onClick={handleRemoveCustom}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              حذف
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <Upload className="w-6 h-6 text-slate-400" />
            <p className="text-sm text-slate-500">رفع نغمة مخصصة</p>
            <p className="text-xs text-slate-400">MP3، WAV، OGG (حتى 5 ميغابايت)</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-1 px-4 py-1.5 rounded-xl text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              اختيار ملف
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
      </div>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 font-bold text-white bg-gradient-to-r from-violet-500 to-purple-500 shadow-md shadow-violet-400/25 hover:opacity-90 transition-all active:scale-[0.98]"
      >
        {saved ? (
          <><Check className="w-5 h-5" />تم الحفظ ✔</>
        ) : (
          <>حفظ الإعداد</>
        )}
      </button>
    </div>
  );
}
