import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAndSaveCallLog,
  deleteCallLog,
  generateInsights,
  listCallLogs,
} from "@/lib/call-logs.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowUp,
  Ban,
  DollarSign,
  FileSignature,
  LogOut,
  MessageSquare,
  PhoneCall,
  Shield,
  Sparkles,
  Ticket,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Dashboard · CallInsight" },
      { name: "description", content: "Log and analyze your customer retention calls." },
    ],
  }),
});

type Category = "saved" | "closed" | "resign" | "other";

const CATEGORY_META: Record<Category, { label: string; icon: typeof Shield; color: string; ring: string }> = {
  saved: { label: "Saved", icon: Shield, color: "text-emerald-600 bg-emerald-500/10", ring: "ring-emerald-500/20" },
  closed: { label: "Closed", icon: Ban, color: "text-rose-600 bg-rose-500/10", ring: "ring-rose-500/20" },
  resign: { label: "Resign", icon: FileSignature, color: "text-blue-600 bg-blue-500/10", ring: "ring-blue-500/20" },
  other: { label: "Other", icon: MessageSquare, color: "text-muted-foreground bg-muted", ring: "ring-border" },
};

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeAndSaveCallLog);
  const del = useServerFn(deleteCallLog);
  const listFn = useServerFn(listCallLogs);
  const insightsFn = useServerFn(generateInsights);

  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const { data: logs = [] } = useQuery({
    queryKey: ["call_logs"],
    queryFn: () => listFn(),
  });

  const analyzeMut = useMutation({
    mutationFn: (n: string) => analyze({ data: { notes: n } }),
    onSuccess: () => {
      setNotes("");
      qc.invalidateQueries({ queryKey: ["call_logs"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Call analyzed and logged");
      textareaRef.current?.focus();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to analyze"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["call_logs"] });
      if (selectedId) setSelectedId(null);
      toast.success("Deleted");
    },
  });

  const insightsQuery = useQuery({
    queryKey: ["insights", logs.length],
    queryFn: () => insightsFn(),
    enabled: logs.length > 0,
    staleTime: 60_000,
  });

  const totals = useMemo(() => {
    const t = { saved: 0, closed: 0, resign: 0, other: 0, revenue: 0, couponsUsed: 0 };
    for (const l of logs) {
      t[l.category as Category] += 1;
      if (l.category === "resign" && l.price_per_service && l.agreement_length_months) {
        t.revenue += Number(l.price_per_service) * l.agreement_length_months;
      }
      if (l.coupon) t.couponsUsed += 1;
    }
    return t;
  }, [logs]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.category === filter);
  const selected = logs.find((l) => l.id === selectedId) ?? null;

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function submit() {
    const trimmed = notes.trim();
    if (trimmed.length < 5) {
      toast.error("Paste some call notes first");
      return;
    }
    analyzeMut.mutate(trimmed);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PhoneCall className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">CallInsight</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Stat grid */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            active={filter === "saved"}
            onClick={() => setFilter(filter === "saved" ? "all" : "saved")}
            meta={CATEGORY_META.saved}
            value={totals.saved}
            label="Saved from cancel"
          />
          <StatCard
            active={filter === "closed"}
            onClick={() => setFilter(filter === "closed" ? "all" : "closed")}
            meta={CATEGORY_META.closed}
            value={totals.closed}
            label="Accounts closed"
          />
          <StatCard
            active={filter === "resign"}
            onClick={() => setFilter(filter === "resign" ? "all" : "resign")}
            meta={CATEGORY_META.resign}
            value={totals.resign}
            label="New resigns"
          />
          <StatCard
            active={filter === "other"}
            onClick={() => setFilter(filter === "other" ? "all" : "other")}
            meta={CATEGORY_META.other}
            value={totals.other}
            label="Other"
          />
        </section>

        <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniStat icon={DollarSign} label="Committed revenue (resigns)" value={`$${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <MiniStat icon={Ticket} label="Coupons discussed" value={totals.couponsUsed.toString()} />
          <MiniStat icon={PhoneCall} label="Total calls logged" value={logs.length.toString()} />
          <MiniStat
            icon={FileSignature}
            label="Save rate"
            value={logs.length ? `${Math.round((totals.saved / Math.max(1, totals.saved + totals.closed)) * 100)}%` : "—"}
          />
        </section>

        {/* Composer */}
        <section className="mt-8">
          <div className="rounded-2xl border bg-card p-4 shadow-sm ring-1 ring-black/5">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">Log a new call</label>
              <span className="text-xs text-muted-foreground">AI will categorize and extract details</span>
            </div>
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                placeholder="Paste your call summary here... e.g. 'Customer wanted to cancel their Pro plan. Offered 20% off for 6 months. Agreed to stay 12 more months at $49/mo with coupon SAVE20.'"
                className="min-h-[140px] resize-none rounded-xl border-none bg-transparent pr-14 text-sm shadow-none focus-visible:ring-0"
              />
              <Button
                size="icon"
                onClick={submit}
                disabled={analyzeMut.isPending || notes.trim().length < 5}
                className="absolute bottom-2 right-2 h-10 w-10 rounded-xl"
              >
                {analyzeMut.isPending ? (
                  <Sparkles className="h-4 w-4 animate-pulse" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Tip: press ⌘/Ctrl + Enter to submit
            </p>
          </div>
        </section>

        {/* Two-column: list + insights */}
        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {filter === "all" ? "All calls" : CATEGORY_META[filter].label}
                <span className="ml-2 text-muted-foreground/60">{filtered.length}</span>
              </h2>
              {filter !== "all" && (
                <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setFilter("all")}>
                  Clear filter
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No calls yet. Paste a summary above to get started.
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((l) => (
                  <CallCard
                    key={l.id}
                    log={l}
                    onSelect={() => setSelectedId(l.id)}
                    onDelete={() => deleteMut.mutate(l.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">AI insights</h3>
              </div>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Log at least one call to see insights.</p>
              ) : insightsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Analyzing your data…</p>
              ) : (
                <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm text-foreground/90">
                  {insightsQuery.data?.insights}
                </div>
              )}
            </div>
          </aside>
        </section>
      </main>

      {selected && <DetailDrawer log={selected} onClose={() => setSelectedId(null)} onDelete={() => deleteMut.mutate(selected.id)} />}
    </div>
  );
}

function StatCard({
  meta,
  value,
  label,
  active,
  onClick,
}: {
  meta: (typeof CATEGORY_META)[Category];
  value: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition-all hover:shadow-md",
        active && "ring-2 ring-primary",
      )}
    >
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", meta.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </button>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof DollarSign; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card/60 px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

type Log = Awaited<ReturnType<typeof listCallLogs>>[number];

function CallCard({ log, onSelect, onDelete }: { log: Log; onSelect: () => void; onDelete: () => void }) {
  const meta = CATEGORY_META[log.category as Category];
  const Icon = meta.icon;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => (e.key === "Enter" ? onSelect() : null)}
        className="group flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md hover:border-foreground/20"
      >
        <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", meta.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {log.customer_name || "Unnamed customer"}
            </span>
            <Badge variant="secondary" className="text-[10px] uppercase">
              {meta.label}
            </Badge>
            {log.coupon && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Ticket className="h-3 w-3" />
                {log.coupon}
              </Badge>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{log.summary}</p>
          {log.category === "resign" && (log.price_per_service || log.agreement_length_months) && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {log.price_per_service != null && <span>💵 ${log.price_per_service}/svc</span>}
              {log.agreement_length_months != null && <span>📅 {log.agreement_length_months} mo</span>}
              {log.service_name && <span>📦 {log.service_name}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <span className="text-[10px] text-muted-foreground">
            {new Date(log.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>
    </li>
  );
}

function DetailDrawer({ log, onClose, onDelete }: { log: Log; onClose: () => void; onDelete: () => void }) {
  const meta = CATEGORY_META[log.category as Category];
  const Icon = meta.icon;
  const points = Array.isArray(log.key_points) ? (log.key_points as string[]) : [];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", meta.color)}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{log.customer_name || "Unnamed customer"}</h2>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{meta.label}</Badge>
                <span>{new Date(log.created_at).toLocaleString()}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <Section title="Summary">
            <p className="text-sm text-foreground/90">{log.summary}</p>
          </Section>

          {(log.service_name || log.price_per_service || log.agreement_length_months) && (
            <Section title="Agreement details">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {log.service_name && <Field label="Service" value={log.service_name} />}
                {log.price_per_service != null && <Field label="Price / service" value={`$${log.price_per_service}`} />}
                {log.agreement_length_months != null && <Field label="Agreement length" value={`${log.agreement_length_months} months`} />}
                {log.price_per_service != null && log.agreement_length_months != null && (
                  <Field label="Total value" value={`$${(Number(log.price_per_service) * log.agreement_length_months).toLocaleString()}`} />
                )}
              </dl>
            </Section>
          )}

          {(log.coupon || log.coupon_value) && (
            <Section title="Coupon">
              <div className="flex items-center gap-2 text-sm">
                <Ticket className="h-4 w-4 text-muted-foreground" />
                {log.coupon && <span className="font-medium">{log.coupon}</span>}
                {log.coupon_value && <span className="text-muted-foreground">— {log.coupon_value}</span>}
              </div>
            </Section>
          )}

          {points.length > 0 && (
            <Section title="Key points">
              <ul className="space-y-1.5 text-sm">
                {points.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {log.sentiment && (
            <Section title="Sentiment">
              <Badge variant="outline" className="capitalize">{log.sentiment}</Badge>
            </Section>
          )}

          <Section title="Original notes">
            <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-muted-foreground">{log.raw_notes}</p>
          </Section>

          <div className="pt-2">
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete call log
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}