import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Alert, AlertStatus } from "@shared/schema";

export type AlertRow = Alert & { allowedTransitions: AlertStatus[] };
export type AlertDetail = AlertRow & {
  events: { id: number; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; userName: string | null }[];
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  novo: "Novo", reconhecido: "Reconhecido", em_acompanhamento: "Em acompanhamento", resolvido: "Resolvido", descartado: "Descartado",
};

/** Organization-scoped alerts. */
export function useAlerts(status?: string) {
  return useQuery<AlertRow[]>({
    queryKey: ["/api/alerts", status ?? "all"],
    queryFn: () => api("GET", `/api/alerts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  });
}

export function useAlert(id: number | null) {
  return useQuery<AlertDetail>({
    queryKey: ["/api/alerts", "detail", id],
    queryFn: () => api("GET", `/api/alerts/${id}`),
    enabled: !!id,
  });
}

export function useAlertTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; status: AlertStatus; note?: string; assignToMe?: boolean }) =>
      api("POST", `/api/alerts/${v.id}/status`, { status: v.status, note: v.note || undefined, assignToMe: v.assignToMe }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/alerts"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    },
  });
}
