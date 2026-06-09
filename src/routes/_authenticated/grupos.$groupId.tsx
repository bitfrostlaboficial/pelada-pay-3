import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/grupos/$groupId")({
  head: () => ({ meta: [{ title: "Súmula — Peladeiro" }] }),
  component: GroupDashboard,
});

type Group = { id: string; name: string; description: string | null; default_monthly_fee: number | null; pix_key: string | null; pix_recipient_name: string | null };
type Participant = { id: string; name: string; position: string | null; jersey_number: number | null; type: "mensalista" | "avulso"; is_active: boolean };
type Charge = { id: string; participant_id: string; description: string; amount: number; due_date: string; status: "pendente" | "pago" | "vencido" | "cancelado"; paid_at: string | null; public_token: string; created_at: string };

function GroupDashboard() {
  const { groupId } = Route.useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [pName, setPName] = useState("");
  const [pPosition, setPPosition] = useState("");
  const [pPhone, setPPhone] = useState("");

  const load = async () => {
    const [g, p, c] = await Promise.all([
      supabase.from("groups").select("*").eq("id", groupId).maybeSingle(),
      supabase.from("participants").select("*").eq("group_id", groupId).order("name"),
      supabase.from("charges").select("*").eq("group_id", groupId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (g.error || !g.data) { toast.error("Pelada não encontrada"); navigate({ to: "/grupos" }); return; }
    setGroup(g.data as Group);
    setParticipants((p.data ?? []) as Participant[]);
    setCharges((c.data ?? []) as Charge[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [groupId]);

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("participants").insert({ group_id: groupId, name: pName, position: pPosition || null, phone: pPhone || null });
    if (error) return toast.error(error.message);
    setPName(""); setPPosition(""); setPPhone(""); setShowAddPlayer(false);
    toast.success("Jogador adicionado");
    load();
  };

  const markPaid = async (chargeId: string) => {
    const { error } = await supabase.from("charges").update({ status: "pago", paid_at: new Date().toISOString() }).eq("id", chargeId);
    if (error) return toast.error(error.message);
    toast.success("Cobrança marcada como paga");
    load();
  };

  if (loading || !group) return <main className="max-w-6xl mx-auto px-6 py-12 font-serif italic text-faded">Carregando súmula...</main>;

  const totalPago = charges.filter((c) => c.status === "pago").reduce((s, c) => s + Number(c.amount), 0);
  const totalPendente = charges.filter((c) => c.status === "pendente").reduce((s, c) => s + Number(c.amount), 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = charges.filter((c) => c.status === "pendente" && c.due_date < today);
  const totalVencido = overdue.reduce((s, c) => s + Number(c.amount), 0);
  const pName2id = new Map(participants.map((p) => [p.id, p.name]));

  const statusByParticipant = new Map<string, "em_dia" | "pendente" | "vencido">();
  for (const c of charges) {
    if (c.status === "pago") continue;
    const isOverdue = c.due_date < today;
    const cur = statusByParticipant.get(c.participant_id);
    if (isOverdue) statusByParticipant.set(c.participant_id, "vencido");
    else if (cur !== "vencido") statusByParticipant.set(c.participant_id, "pendente");
  }

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" }).toUpperCase().replace(/\./g, "");

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">
      <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-ink/10 pb-6">
        <div>
          <Link to="/grupos" className="font-serif italic text-sm text-faded hover:text-pitch">← Suas peladas</Link>
          <h1 className="font-display text-5xl md:text-6xl uppercase leading-none mt-2">{group.name}</h1>
          {group.description && <p className="font-serif italic text-sm text-faded mt-2">{group.description}</p>}
        </div>
        <Link
          to="/grupos/$groupId/cobrar"
          params={{ groupId }}
          className="bg-pitch text-paper px-6 py-3 font-display text-xl tracking-wide flex items-center gap-3 hover:bg-ink transition-colors shadow-ledger active:translate-y-0.5 active:shadow-none self-start"
        >
          COBRAR <span className="text-canarinho">+</span>
        </Link>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {/* Placar Financeiro */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-0 border-2 border-ink divide-y md:divide-y-0 md:divide-x-2 divide-ink shadow-ledger-soft bg-white">
            <div className="p-6 animate-count">
              <p className="font-serif italic text-sm text-faded mb-1">R$ Coletado</p>
              <p className="font-display text-4xl text-pitch">{fmt(totalPago)}</p>
            </div>
            <div className="p-6 animate-count [animation-delay:100ms]">
              <p className="font-serif italic text-sm text-faded mb-1">R$ Pendente</p>
              <p className="font-display text-4xl text-canarinho drop-shadow-[0_1px_rgba(0,0,0,0.1)]">{fmt(totalPendente - totalVencido)}</p>
            </div>
            <div className="p-6 animate-count [animation-delay:200ms]">
              <p className="font-serif italic text-sm text-faded mb-1">R$ Vencido</p>
              <p className="font-display text-4xl text-destructive">{fmt(totalVencido)}</p>
            </div>
          </section>

          {/* Súmula de Cobranças */}
          <section>
            <h2 className="font-serif italic text-xl mb-4 border-l-4 border-canarinho pl-3">Súmula de Cobranças</h2>
            <div className="bg-white border border-ink/10">
              <div className="grid grid-cols-12 gap-2 p-4 border-b border-ink/20 bg-ink/5 font-bold text-[10px] uppercase tracking-widest">
                <div className="col-span-5">Jogador / Referência</div>
                <div className="col-span-2 hidden md:block">Vence</div>
                <div className="col-span-2">Valor</div>
                <div className="col-span-3 md:col-span-3 text-right">Status</div>
              </div>
              {charges.length === 0 ? (
                <div className="p-8 text-center font-serif italic text-faded">Nenhuma cobrança ainda. Crie a primeira!</div>
              ) : charges.map((c, i) => {
                const isOverdue = c.status === "pendente" && c.due_date < today;
                const effStatus = isOverdue ? "vencido" : c.status;
                return (
                  <div key={c.id} className="grid grid-cols-12 gap-2 p-4 border-b border-ink/5 items-center hover:bg-paper/50 transition-colors animate-row" style={{ animationDelay: `${i * 30}ms` }}>
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="size-8 rounded-full bg-ink/5 border border-ink/10 flex items-center justify-center font-serif italic text-xs shrink-0">
                        {(pName2id.get(c.participant_id) ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{pName2id.get(c.participant_id) ?? "—"}</p>
                        <p className="text-[10px] text-faded truncate">{c.description}</p>
                      </div>
                    </div>
                    <div className="col-span-2 text-xs font-mono hidden md:block">{fmtDate(c.due_date)}</div>
                    <div className="col-span-2 font-display text-lg">{fmt(Number(c.amount))}</div>
                    <div className="col-span-5 md:col-span-3 text-right flex items-center justify-end gap-2 flex-wrap">
                      <StatusBadge status={effStatus} />
                      {c.status === "pendente" && (
                        <button onClick={() => markPaid(c.id)} className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 border border-pitch text-pitch hover:bg-pitch hover:text-paper transition-colors">Marcar pago</button>
                      )}
                      <Link to="/pagar/$token" params={{ token: c.public_token }} target="_blank" className="text-[10px] font-bold uppercase tracking-widest text-faded hover:text-pitch">Link ↗</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Sidebar: Escalação */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="bg-white border-2 border-ink p-6 relative overflow-hidden">
            <div className="absolute -right-4 -top-4 opacity-5 pointer-events-none">
              <div className="size-32 border-[12px] border-ink rounded-full" />
            </div>
            <h3 className="font-display text-2xl mb-6 flex items-center justify-between">
              ESCALAÇÃO
              <span className="font-serif italic text-xs normal-case font-normal text-faded">{participants.length} {participants.length === 1 ? "Jogador" : "Jogadores"}</span>
            </h3>

            {participants.length === 0 ? (
              <p className="font-serif italic text-sm text-faded">Adicione jogadores para começar a cobrar.</p>
            ) : (
              <div className="space-y-4">
                {participants.map((p) => {
                  const st = statusByParticipant.get(p.id);
                  const dot = st === "vencido" ? "bg-destructive" : st === "pendente" ? "bg-canarinho" : "bg-pitch";
                  const label = st === "vencido" ? "Vencido" : st === "pendente" ? "Pendente" : "Em dia";
                  return (
                    <div key={p.id} className="flex items-center justify-between group">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="size-10 rounded-sm bg-paper outline outline-ink/10 flex items-center justify-center font-serif italic text-sm">
                            {p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                          </div>
                          <div className={`absolute -bottom-1 -right-1 size-3 ${dot} border-2 border-white rounded-full`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate">{p.name}</p>
                          <p className="text-[10px] text-faded uppercase tracking-tighter truncate">{p.position || p.type} · {label}</p>
                        </div>
                      </div>
                      {p.jersey_number && <div className="font-mono text-xs opacity-40 group-hover:opacity-100">#{p.jersey_number}</div>}
                    </div>
                  );
                })}
              </div>
            )}

            {showAddPlayer ? (
              <form onSubmit={addPlayer} className="mt-6 space-y-2">
                <input value={pName} onChange={(e) => setPName(e.target.value)} required placeholder="Nome" className="w-full px-3 py-2 border-2 border-ink/20 focus:border-pitch outline-none text-sm" />
                <input value={pPosition} onChange={(e) => setPPosition(e.target.value)} placeholder="Posição (opcional)" className="w-full px-3 py-2 border-2 border-ink/20 focus:border-pitch outline-none text-sm" />
                <input value={pPhone} onChange={(e) => setPPhone(e.target.value)} placeholder="Telefone (opcional)" className="w-full px-3 py-2 border-2 border-ink/20 focus:border-pitch outline-none text-sm" />
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 bg-pitch text-paper py-2 text-xs font-bold uppercase tracking-widest">Adicionar</button>
                  <button type="button" onClick={() => setShowAddPlayer(false)} className="px-3 border border-ink/20 text-xs font-bold uppercase tracking-widest">×</button>
                </div>
              </form>
            ) : (
              <button onClick={() => setShowAddPlayer(true)} className="w-full mt-8 py-2 border border-ink/20 text-xs font-bold uppercase tracking-widest hover:bg-ink hover:text-white transition-colors">
                + Adicionar jogador
              </button>
            )}
          </div>

          <div className="p-6 border border-dashed border-ink/30 bg-paper">
            <h4 className="font-serif italic text-sm mb-2">Método de recebimento</h4>
            <p className="font-display text-xl">PIX MANUAL</p>
            <p className="text-xs text-faded mt-1">{group.pix_key ? `${group.pix_key}` : "Configure a chave Pix nas opções da pelada"}</p>
          </div>
        </aside>
      </main>
    </main>
  );
}

function StatusBadge({ status }: { status: "pendente" | "pago" | "vencido" | "cancelado" }) {
  const map = {
    pago: "bg-green-100 text-green-800 border-green-200",
    pendente: "bg-yellow-100 text-yellow-800 border-yellow-200",
    vencido: "bg-red-100 text-red-800 border-red-200",
    cancelado: "bg-gray-100 text-gray-700 border-gray-200",
  } as const;
  const labels = { pago: "PAGO", pendente: "PENDENTE", vencido: "VENCIDO", cancelado: "CANCELADO" };
  return <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border ${map[status]}`}>{labels[status]}</span>;
}