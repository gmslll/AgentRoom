import { create } from "zustand";
import type { AgentDelivery } from "../api/types";

interface DeliveryState {
  /** Deliveries keyed by delivery.id. */
  byId: Record<string, AgentDelivery>;
  upsertDeliveries: (deliveries: AgentDelivery[]) => void;
  upsertDelivery: (delivery: AgentDelivery) => void;
  reset: () => void;
}

export const useDeliveryStore = create<DeliveryState>()((set) => ({
  byId: {},
  upsertDeliveries: (deliveries) =>
    set((state) => ({
      byId: deliveries.reduce(
        (acc, d) => {
          acc[d.id] = d;
          return acc;
        },
        { ...state.byId },
      ),
    })),
  upsertDelivery: (delivery) =>
    set((state) => ({ byId: { ...state.byId, [delivery.id]: delivery } })),
  reset: () => set({ byId: {} }),
}));

/** Deliveries for a task message, by delivery.id (stable map). */
export function selectDeliveriesForTask(
  state: DeliveryState,
  taskMessageId: string,
): AgentDelivery[] {
  return Object.values(state.byId).filter(
    (d) => d.taskMessageId === taskMessageId,
  );
}
