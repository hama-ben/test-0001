import { create } from "zustand";

interface SupportChatStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSupportChatStore = create<SupportChatStore>((set) => ({
  isOpen: false,
  open:  () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
