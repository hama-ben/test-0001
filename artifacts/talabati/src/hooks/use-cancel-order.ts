import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface CancelOrderResult {
  success: boolean;
  orderId: string;
}

export function useCancelOrder() {
  return useMutation<CancelOrderResult, Error, { orderId: string }>({
    mutationFn: async ({ orderId }) => {
      return customFetch<CancelOrderResult>(`/api/orders/${orderId}`, {
        method: "DELETE",
      });
    },
  });
}
