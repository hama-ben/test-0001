import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket-client";
import { useToast } from "@/hooks/use-toast";
import {
  getGetDriverAccountQueryKey,
  getGetDriverSubscriptionQueryKey,
} from "@workspace/api-client-react";

/**
 * Listens for the `subscription_approved` Socket.io event emitted exclusively
 * to this driver's private room (`user:<driverId>`).
 *
 * No other user receives this event — the server calls emitToUser() which
 * targets only the individual driver's socket room.
 *
 * On receipt:
 *  1. Shows a private toast congratulating the driver.
 *  2. Invalidates the account + subscription queries so the UI refreshes
 *     immediately to reflect the new expiry date.
 */
export function useSubscriptionNotifications(driverId: string | null): void {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!driverId) return;

    const socket = getSocket();

    function handleSubscriptionApproved() {
      toast({
        title: "تم تأكيد الدفع ✅",
        description:
          "تم تأكيد وصل الدفع الخاص بك بنجاح، وتمت إضافة 30 يوماً إلى حسابك! 🚀",
        duration: 8000,
      });

      queryClient.invalidateQueries({
        queryKey: getGetDriverAccountQueryKey(driverId!),
      });
      queryClient.invalidateQueries({
        queryKey: getGetDriverSubscriptionQueryKey(driverId!),
      });
    }

    function handlePaymentRejected() {
      toast({
        title: "تم رفض الوصل ❌",
        description:
          "عذراً، تم رفض وصل الدفع الخاص بك. يرجى التحقق من الوصل والمحاولة مرة أخرى.",
        duration: 10000,
        variant: "destructive",
      });

      queryClient.invalidateQueries({
        queryKey: getGetDriverAccountQueryKey(driverId!),
      });
      queryClient.invalidateQueries({
        queryKey: getGetDriverSubscriptionQueryKey(driverId!),
      });
    }

    socket.on("subscription_approved", handleSubscriptionApproved);
    socket.on("payment_rejected", handlePaymentRejected);

    return () => {
      socket.off("subscription_approved", handleSubscriptionApproved);
      socket.off("payment_rejected", handlePaymentRejected);
    };
  }, [driverId, toast, queryClient]);
}
