import { create } from "zustand";

interface OrderNotificationStore {
  count: number;
  increment: () => void;
  reset: () => void;
}

export const useOrderNotificationStore = create<OrderNotificationStore>((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
  reset: () => set({ count: 0 }),
}));
