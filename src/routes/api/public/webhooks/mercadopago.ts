import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mpGetPayment, mapMpStatus } from "@/lib/payments/mercado-pago.server";

export const Route = createFileRoute("/api/public/webhooks/mercadopago")({
  server: {
    handlers: {
      GET: async () => new Response("ok"),
      POST: async ({ request }) => {
        let payload: any = {};
        try {
          payload = await request.json();
        } catch {
          payload = {};
        }
        const url = new URL(request.url);
        const queryId = url.searchParams.get("data.id") || url.searchParams.get("id");
        const paymentId: string | undefined =
          payload?.data?.id?.toString() ?? payload?.resource?.toString() ?? queryId ?? undefined;
        const topic: string =
          payload?.type ?? payload?.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "";

        console.log("[MP] WEBHOOK_RECEIVED", { topic, paymentId });

        // Sempre responde 200 rápido para evitar reentrega
        if (!paymentId) return new Response("ok");
        if (topic && !topic.includes("payment")) return new Response("ok");

        try {
          const { status, raw } = await mpGetPayment(paymentId);
          const newStatus = mapMpStatus(status);
          const externalRef: string | undefined = raw?.external_reference?.toString();

          const update: Record<string, unknown> = { status: newStatus };
          if (newStatus === "pago") {
            update.paid_at = raw?.date_approved ?? new Date().toISOString();
            update.paid_amount = raw?.transaction_amount ?? undefined;
          }

          // Atualiza por external_reference (nosso charges.id) — mais confiável
          if (externalRef) {
            await supabaseAdmin.from("charges").update(update).eq("id", externalRef);
          } else {
            await supabaseAdmin
              .from("charges")
              .update(update)
              .eq("provider", "mercado_pago")
              .eq("provider_charge_id", paymentId);
          }
        } catch (err) {
          console.error("[MP] WEBHOOK_ERROR", err);
        }

        return new Response("ok");
      },
    },
  },
});