import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getProvider } from "@/lib/payments";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/grupos/$groupId/cobrar")({
  head: () => ({ meta: [{ title: "Nova cobrança — Peladeiro" }] }),
  component: NewChargePage,
});

type Participant = { id: string; name: string };
type Group = { id: string; name: string; default_monthly_fee: number | null; pix_key: string | null; pix_recipient_name: string | null };

function NewChargePage() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("groups").select("id,name,default_monthly_fee,pix_key,pix_recipient_name").eq("id", groupId).maybeSingle(),
      supabase.from("participants").select("id,name").eq("group_id", groupId).eq("is_active", true).order("name"),
    ]).then(([g, p]) => {
      if (g.data) {
        setGroup(g.data as Group);
        if (g.data.default_monthly_fee) setAmount(String(g.data.default_monthly_fee));
        const ref = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        setDescription(`Mensalidade ${ref}`);
      }
      setParticipants((p.data ?? []) as Participant[]);
    });
  }, [groupId]);

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };
  const toggleAll = () => setSelected(selected.size === participants.length ? new Set() : new Set(participants.map((p) => p.id)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) return toast.error("Selecione ao menos um jogador");
    if (!group) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const provider = getProvider({
      provider: "pix_manual",
      config: { pix_key: group.pix_key ?? "", recipient_name: group.pix_recipient_name ?? "" },
    });

    const inserts = Array.from(selected).map((participant_id) => ({
      group_id: groupId,
      participant_id,
      description,
      amount: Number(amount),
      due_date: dueDate,
      status: "pendente" as const,
      provider: "pix_manual" as const,
      created_by: userId,
    }));

    const { data: inserted, error } = await supabase.from("charges").insert(inserts).select();
    if (error || !inserted) { toast.error(error?.message ?? "Erro"); setSaving(false); return; }

    // Gera Pix copia-e-cola para cada (se chave configurada)
    if (group.pix_key && group.pix_recipient_name) {
      await Promise.all(inserted.map(async (c) => {
        const part = participants.find((p) => p.id === c.participant_id);
        const res = await provider.createCharge({
          amount: Number(c.amount),
          description: c.description,
          dueDate: c.due_date,
          payerName: part?.name ?? "Jogador",
          externalId: c.id,
        });
        await supabase.from("charges").update({
          pix_copy_paste: res.pixCopyPaste,
          provider_charge_id: res.providerChargeId,
        }).eq("id", c.id);
      }));
    }

    toast.success(`${inserted.length} cobrança(s) criada(s)`);
    navigate({ to: "/grupos/$groupId", params: { groupId } });
  };

  if (!group) return <main className="max-w-3xl mx-auto px-6 py-12 font-serif italic text-faded">Carregando...</main>;

  return (
    <main className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <Link to="/grupos/$groupId" params={{ groupId }} className="font-serif italic text-sm text-faded hover:text-pitch">← Voltar para súmula</Link>
      <h1 className="font-display text-5xl uppercase mt-2 mb-1">Nova cobrança</h1>
      <p className="font-serif italic text-faded mb-8">{group.name}</p>

      <form onSubmit={submit} className="space-y-6 bg-white border-2 border-ink shadow-ledger-soft p-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-widest">Descrição</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} required className="w-full mt-1 px-3 py-2 border-2 border-ink/20 focus:border-pitch outline-none" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest">Valor (R$)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} required type="number" step="0.01" min="0" className="w-full mt-1 px-3 py-2 border-2 border-ink/20 focus:border-pitch outline-none font-display text-2xl" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest">Vencimento</label>
            <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} required type="date" className="w-full mt-1 px-3 py-2 border-2 border-ink/20 focus:border-pitch outline-none" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-widest">Jogadores ({selected.size}/{participants.length})</label>
            <button type="button" onClick={toggleAll} className="text-xs font-bold uppercase tracking-widest text-pitch hover:underline">{selected.size === participants.length ? "Desmarcar todos" : "Marcar todos"}</button>
          </div>
          {participants.length === 0 ? (
            <p className="font-serif italic text-faded text-sm border border-dashed border-ink/20 p-4">Adicione jogadores na escalação primeiro.</p>
          ) : (
            <div className="border-2 border-ink/10 max-h-72 overflow-y-auto divide-y divide-ink/5">
              {participants.map((p) => (
                <label key={p.id} className="flex items-center gap-3 p-3 hover:bg-paper cursor-pointer">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="size-4 accent-pitch" />
                  <span className="text-sm font-bold">{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {!group.pix_key && (
          <div className="border-2 border-canarinho bg-canarinho/10 p-3 text-xs">
            <strong>Atenção:</strong> Configure a chave Pix da pelada para gerar o copia-e-cola automaticamente. A cobrança será criada mesmo assim.
          </div>
        )}

        <button type="submit" disabled={saving || selected.size === 0} className="w-full bg-pitch text-paper py-3 font-display text-xl tracking-wide shadow-ledger disabled:opacity-50">
          {saving ? "GERANDO..." : `GERAR ${selected.size} COBRANÇA${selected.size === 1 ? "" : "S"}`}
        </button>
      </form>
    </main>
  );
}