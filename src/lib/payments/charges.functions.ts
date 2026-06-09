import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mpCreatePixPayment } from "./mercado-pago.server";

export interface CreateMPChargeInput {
  groupId: string;
  participantIds: string[];
  description: string;
  amount: number;
  dueDate: string; // yyyy-mm-dd
}

export const createMercadoPagoCharges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateMPChargeInput) => {
    if (!input?.groupId) throw new Error("groupId obrigatório");
    if (!Array.isArray(input.participantIds) || input.participantIds.length === 0)
      throw new Error("Selecione ao menos um jogador");
    if (!input.description || input.description.length > 255) throw new Error("Descrição inválida");
    if (!(input.amount > 0) || input.amount > 1_000_000) throw new Error("Valor inválido");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error("Vencimento inválido");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Carrega participantes (RLS garante que pertencem a grupo do user)
    const { data: participants, error: pErr } = await supabase
      .from("participants")
      .select("id,name,email,group_id")
      .in("id", data.participantIds)
      .eq("group_id", data.groupId);
    if (pErr) throw new Error(pErr.message);
    if (!participants || participants.length === 0) throw new Error("Jogadores não encontrados");

    // Pix expira no fim do dia de vencimento
    const dueIso = new Date(`${data.dueDate}T23:59:59-03:00`).toISOString();

    const created: Array<{
      id: string;
      participant_id: string;
      participant_name: string;
      amount: number;
      description: string;
      status: string;
      pix_copy_paste: string | null;
      pix_qr_code: string | null;
      payment_link: string | null;
      provider_charge_id: string | null;
      public_token: string;
      error?: string;
    }> = [];

    for (const p of participants) {
      // 1) cria a linha primeiro para ter o id (idempotency)
      const { data: inserted, error: insErr } = await supabase
        .from("charges")
        .insert({
          group_id: data.groupId,
          participant_id: p.id,
          description: data.description,
          amount: data.amount,
          due_date: data.dueDate,
          status: "pendente" as const,
          provider: "mercado_pago" as const,
          created_by: userId,
        })
        .select("id,public_token")
        .single();
      if (insErr || !inserted) {
        console.error("[CHARGE] insert error", insErr);
        throw new Error(insErr?.message ?? "Erro ao criar cobrança");
      }

      // 2) chama Mercado Pago
      try {
        const mp = await mpCreatePixPayment({
          amount: Number(data.amount),
          description: data.description,
          externalId: inserted.id,
          payerName: p.name,
          payerEmail: p.email ?? undefined,
          dueDateISO: dueIso,
        });

        await supabase
          .from("charges")
          .update({
            provider_charge_id: mp.providerChargeId,
            pix_copy_paste: mp.qrCode,
            pix_qr_code: mp.qrCodeBase64,
            payment_link: mp.ticketUrl ?? null,
          })
          .eq("id", inserted.id);

        created.push({
          id: inserted.id,
          participant_id: p.id,
          participant_name: p.name,
          amount: Number(data.amount),
          description: data.description,
          status: "pendente",
          pix_copy_paste: mp.qrCode,
          pix_qr_code: mp.qrCodeBase64,
          payment_link: mp.ticketUrl ?? null,
          provider_charge_id: mp.providerChargeId,
          public_token: inserted.public_token,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro Mercado Pago";
        console.error("[CHARGE] MP error, marcando cobrança como cancelada", inserted.id, msg);
        await supabase.from("charges").update({ status: "cancelado" }).eq("id", inserted.id);
        created.push({
          id: inserted.id,
          participant_id: p.id,
          participant_name: p.name,
          amount: Number(data.amount),
          description: data.description,
          status: "cancelado",
          pix_copy_paste: null,
          pix_qr_code: null,
          payment_link: null,
          provider_charge_id: null,
          public_token: inserted.public_token,
          error: msg,
        });
      }
    }

    return { charges: created };
  });