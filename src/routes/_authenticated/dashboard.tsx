import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAndSaveCallLog,
  bulkImportCallLogs,
  deleteCallLog,
  generateInsights,
  listCallLogs,
} from "@/lib/call-logs.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { parseUploadedFile, type ParsedEntry } from "@/lib/parse-uploaded-file";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  ArrowUp,
  Ban,
  BellRing,
  CalendarClock,
  CalendarIcon,
  DollarSign,
  FileSignature,
  Gauge,
  LogOut,
  MessageSquare,
  PhoneCall,
  Search,
  Shield,
  Sparkles,
  Ticket,
  TrendingUp,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Dashboard · CallInsight" },
      { name: "description", content: "Log and analyze your customer retention calls." },
    ],
  }),
});

type Category = "saved" | "closed" | "resign" | "lead" | "other";

const CATEGORY_META: Record<
  Category,
  { label: string; icon: typeof Shield; color: string; dot: string; hex: string }
> = {
  saved: { label: "Saved", icon: Shield, color: "text-emerald-600 bg-emerald-500/10", dot: "bg-emerald-500", hex: "#10b981" },
  closed: { label: "Closed", icon: Ban, color: "text-rose-600 bg-rose-500/10", dot: "bg-rose-500", hex: "#f43f5e" },
  resign: { label: "Resign", icon: FileSignature, color: "text-blue-600 bg-blue-500/10", dot: "bg-blue-500", hex: "#3b82f6" },
  lead: { label: "Lead", icon: TrendingUp, color: "text-amber-600 bg-amber-500/10", dot: "bg-amber-500", hex: "#f59e0b" },
  other: { label: "Other", icon: MessageSquare, color: "text-muted-foreground bg-muted", dot: "bg-muted-foreground/60", hex: "#94a3b8" },
};

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeAndSaveCallLog);
  const del = useServerFn(deleteCallLog);
  const listFn = useServerFn(listCallLogs);
  const insightsFn = useServerFn(generateInsights);
  const bulkImportFn = useServerFn(bulkImportCallLogs);

  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callDate, setCallDate] = useState<Date>(new Date());
  const [dateOpen, setDateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const { data: logs = [] } = useQuery({
    queryKey: ["call_logs"],
    queryFn: () => listFn(),
    refetchInterval: 15000,
  });

  const analyzeMut = useMutation({
    mutationFn: (input: { notes: string; callDate: string }) =>
      analyze({ data: { notes: input.notes, callDate: input.callDate } }),
    onSuccess: () => {
      setNotes("");
      setCallDate(new Date());
      qc.invalidateQueries({ queryKey: ["call_logs"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      toast.success("Call analyzed and logged");
      textareaRef.current?.focus();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to analyze"),
  });

  const bulkMut = useMutation({
    mutationFn: (items: ParsedEntry[]) => bulkImportFn({ data: { items } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["call_logs"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      toast.success(`Imported ${res.inserted} call${res.inserted === 1 ? "" : "s"}`);
      setUploadOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
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

  const stats = useMemo(() => {
    const t = {
      saved: 0,
      closed: 0,
      resign: 0,
      lead: 0,
      other: 0,
      revenue: 0,
      couponsUsed: 0,
      couponTotal: 0,
      followUps: 0,
      agreementSum: 0,
      agreementCount: 0,
    };
    for (const l of logs) {
      t[l.category as Category] += 1;
      if (l.category === "resign" && l.price_per_service && l.agreement_length_months) {
        t.revenue += Number(l.price_per_service) * l.agreement_length_months;
      }
      if (l.agreement_length_months) {
        t.agreementSum += l.agreement_length_months;
        t.agreementCount += 1;
      }
      if (l.coupon || l.coupon_amount) t.couponsUsed += 1;
      if (l.coupon_amount) t.couponTotal += Number(l.coupon_amount);
      if (l.follow_up_needed) t.followUps += 1;
    }
    return t;
  }, [logs]);

  const saveRate = logs.length
    ? Math.round((stats.saved / Math.max(1, stats.saved + stats.closed)) * 100)
    : 0;
  const avgAgreement = stats.agreementCount
    ? Math.round((stats.agreementSum / stats.agreementCount) * 10) / 10
    : 0;

  const categoryPie = useMemo(
    () =>
      (["saved", "closed", "resign", "lead", "other"] as Category[])
        .map((c) => ({ name: CATEGORY_META[c].label, value: stats[c], key: c, fill: CATEGORY_META[c].hex }))
        .filter((d) => d.value > 0),
    [stats],
  );

  const timeseries = useMemo(() => {
    // last 14 days
    const days: { day: string; date: string; saved: number; closed: number; resign: number; coupons: number }[] = [];
    const map = new Map<string, (typeof days)[number]>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const entry = {
        day: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        date: key,
        saved: 0,
        closed: 0,
        resign: 0,
        coupons: 0,
      };
      days.push(entry);
      map.set(key, entry);
    }
    for (const l of logs) {
      const key = new Date(l.call_date ?? l.created_at).toISOString().slice(0, 10);
      const e = map.get(key);
      if (!e) continue;
      if (l.category === "saved") e.saved += 1;
      else if (l.category === "closed") e.closed += 1;
      else if (l.category === "resign") e.resign += 1;
      if (l.coupon_amount) e.coupons += Number(l.coupon_amount);
      else if (l.coupon) e.coupons += 1;
    }
    return days;
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter !== "all" && l.category !== filter) return false;
      if (!q) return true;
      return (
        (l.customer_name ?? "").toLowerCase().includes(q) ||
        (l.customer_id ?? "").toLowerCase().includes(q) ||
        (l.summary ?? "").toLowerCase().includes(q) ||
        (l.service_name ?? "").toLowerCase().includes(q) ||
        (l.coupon ?? "").toLowerCase().includes(q)
      );
    });
  }, [logs, filter, query]);

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
    analyzeMut.mutate({ notes: trimmed, callDate: callDate.toISOString() });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <PhoneCall className="h-3.5 w-3.5" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight">CallInsight</span>
            <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
              Retention command center
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> live
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-4 sm:px-6">
        {/* KPI strip */}
        <section className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Kpi
            active={filter === "saved"}
            onClick={() => setFilter(filter === "saved" ? "all" : "saved")}
            meta={CATEGORY_META.saved}
            value={stats.saved}
            label="Saved"
          />
          <Kpi
            active={filter === "closed"}
            onClick={() => setFilter(filter === "closed" ? "all" : "closed")}
            meta={CATEGORY_META.closed}
            value={stats.closed}
            label="Closed"
          />
          <Kpi
            active={filter === "resign"}
            onClick={() => setFilter(filter === "resign" ? "all" : "resign")}
            meta={CATEGORY_META.resign}
            value={stats.resign}
            label="Resigns"
          />
          <Kpi
            active={filter === "lead"}
            onClick={() => setFilter(filter === "lead" ? "all" : "lead")}
            meta={CATEGORY_META.lead}
            value={stats.lead}
            label="Leads"
          />
          <Kpi
            active={filter === "other"}
            onClick={() => setFilter(filter === "other" ? "all" : "other")}
            meta={CATEGORY_META.other}
            value={stats.other}
            label="Other"
          />
          <MiniKpi icon={FileSignature} label="Save rate" value={logs.length ? `${saveRate}%` : "—"} />
          <MiniKpi icon={CalendarClock} label="Avg agreement" value={avgAgreement ? `${avgAgreement} mo` : "—"} />
          <MiniKpi
            icon={DollarSign}
            label="Resign revenue"
            value={`$${stats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          />
        </section>

        {/* Composer + charts */}
        <section className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Log a call
              </label>
              <div className="flex items-center gap-1.5">
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {format(callDate, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-auto p-0 pointer-events-auto">
                    <Calendar
                      mode="single"
                      selected={callDate}
                      onSelect={(d) => {
                        if (d) setCallDate(d);
                        setDateOpen(false);
                      }}
                      disabled={(d) => d > new Date()}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                    <div className="border-t p-2 flex justify-between text-[11px]">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          const d = new Date();
                          d.setDate(d.getDate() - 1);
                          setCallDate(d);
                          setDateOpen(false);
                        }}
                      >
                        Yesterday
                      </button>
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => {
                          setCallDate(new Date());
                          setDateOpen(false);
                        }}
                      >
                        Today
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => setUploadOpen(true)}
                >
                  <Upload className="h-3.5 w-3.5" /> Import
                </Button>
              </div>
            </div>
            <div className="relative">
              <Textarea
                ref={textareaRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                placeholder="Paste call notes… e.g. 'Jane Doe #A-2201 wanted to cancel. Offered 50% off next regular service ($60 credit). Signed new 12mo agreement at $120/service.'"
                className="min-h-[120px] resize-none rounded-lg border bg-background pr-12 text-sm"
              />
              <Button
                size="icon"
                onClick={submit}
                disabled={analyzeMut.isPending || notes.trim().length < 5}
                className="absolute bottom-2 right-2 h-8 w-8 rounded-lg"
              >
                {analyzeMut.isPending ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              ⌘/Ctrl + Enter to submit · Call date defaults to today — change it above if the call was from a different day. AI still extracts a date it finds in your notes.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChartCard title="Outcomes (14d)">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={timeseries} margin={{ top: 5, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="saved" stackId="a" fill={CATEGORY_META.saved.hex} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="resign" stackId="a" fill={CATEGORY_META.resign.hex} />
                  <Bar dataKey="closed" stackId="a" fill={CATEGORY_META.closed.hex} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <Legend items={[["Saved", CATEGORY_META.saved.hex], ["Resign", CATEGORY_META.resign.hex], ["Closed", CATEGORY_META.closed.hex]]} />
            </ChartCard>

            <ChartCard title="Category mix">
              {categoryPie.length === 0 ? (
                <EmptyChart />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={categoryPie} dataKey="value" innerRadius={34} outerRadius={58} paddingAngle={2} stroke="none">
                        {categoryPie.map((d) => (
                          <Cell key={d.key} fill={d.fill} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Legend items={categoryPie.map((d) => [d.name, d.fill])} />
                </>
              )}
            </ChartCard>

            <ChartCard title="Discount $ / day (14d)">
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={timeseries} margin={{ top: 5, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} width={28} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="coupons" stroke="#a855f7" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><Ticket className="h-3 w-3" /> Coupons used: {stats.couponsUsed}</span>
                <span>Total: ${stats.couponTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            </ChartCard>

            <ChartCard title="Follow-ups">
              <div className="flex h-[140px] flex-col items-center justify-center gap-1">
                <BellRing className="h-5 w-5 text-amber-500" />
                <div className="text-3xl font-semibold tabular-nums">{stats.followUps}</div>
                <div className="text-[11px] text-muted-foreground">calls need follow-up</div>
              </div>
            </ChartCard>
          </div>
        </section>

        {/* Table + insights */}
        <section className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Call log
                <span className="ml-1.5 text-muted-foreground/60">{filtered.length}</span>
              </h2>
              <div className="flex flex-1 items-center gap-2">
                <div className="relative ml-auto w-full max-w-[220px]">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search customer, ID, service…"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                {(filter !== "all" || query) && (
                  <button
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No calls match. Paste a summary above to log one.
              </div>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-[1] bg-card">
                    <TableRow className="text-[10px] uppercase">
                      <TableHead className="h-8">Customer</TableHead>
                      <TableHead className="h-8">ID</TableHead>
                      <TableHead className="h-8">Result</TableHead>
                      <TableHead className="h-8">Details</TableHead>
                      <TableHead className="h-8">Coupon</TableHead>
                      <TableHead className="h-8">Follow-up</TableHead>
                      <TableHead className="h-8 text-right">When</TableHead>
                      <TableHead className="h-8 w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((l) => (
                      <LogRow
                        key={l.id}
                        log={l}
                        onSelect={() => setSelectedId(l.id)}
                        onDelete={() => deleteMut.mutate(l.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <aside className="rounded-xl border bg-card p-3 shadow-sm">
            {logs.length === 0 ? (
              <>
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI insights</h3>
                </div>
                <p className="text-xs text-muted-foreground">Log at least one call to see insights.</p>
              </>
            ) : insightsQuery.isLoading ? (
              <>
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI insights</h3>
                </div>
                <p className="text-xs text-muted-foreground">Analyzing…</p>
              </>
            ) : (
              <div className="space-y-3">
                {insightsQuery.data?.score != null && (
                  <ScoreCard score={insightsQuery.data.score} label={insightsQuery.data.scoreLabel} />
                )}
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily briefing</h3>
                  </div>
                  <MarkdownBlock content={insightsQuery.data?.daily ?? ""} />
                </div>
                <div className="border-t pt-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overall performance</h3>
                  </div>
                  <MarkdownBlock content={insightsQuery.data?.overall ?? ""} />
                </div>
              </div>
            )}
          </aside>
        </section>
      </main>

      <ImportDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onImport={(items) => bulkMut.mutate(items)}
        importing={bulkMut.isPending}
      />

      {selected && <DetailDrawer log={selected} onClose={() => setSelectedId(null)} onDelete={() => deleteMut.mutate(selected.id)} />}
    </div>
  );
}

function Kpi({
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
        "group flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left shadow-sm transition-all hover:border-foreground/25",
        active && "ring-2 ring-primary",
      )}
    >
      <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", meta.color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </button>
  );
}

function MiniKpi({ icon: Icon, label, value }: { icon: typeof DollarSign; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 shadow-sm">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-base font-semibold tabular-nums leading-none">{value}</div>
        <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {items.map(([name, color]) => (
        <span key={name} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
          {name}
        </span>
      ))}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[140px] items-center justify-center text-[11px] text-muted-foreground">
      No data yet
    </div>
  );
}

type Log = Awaited<ReturnType<typeof listCallLogs>>[number];

function LogRow({ log, onSelect, onDelete }: { log: Log; onSelect: () => void; onDelete: () => void }) {
  const meta = CATEGORY_META[log.category as Category];
  const details =
    log.category === "resign"
      ? [
          log.service_name,
          log.price_per_service != null ? `$${log.price_per_service}/svc` : null,
          log.agreement_length_months != null ? `${log.agreement_length_months}mo` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : log.summary;
  return (
    <TableRow onClick={onSelect} className="cursor-pointer text-xs">
      <TableCell className="max-w-[160px] py-2 font-medium">
        <div className="truncate">{log.customer_name || "—"}</div>
      </TableCell>
      <TableCell className="py-2 font-mono text-[11px] text-muted-foreground">
        {log.customer_id || "—"}
      </TableCell>
      <TableCell className="py-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase", meta.color)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </TableCell>
      <TableCell className="max-w-[280px] py-2 text-muted-foreground">
        <div className="line-clamp-1">{details || "—"}</div>
      </TableCell>
      <TableCell className="py-2">
        {log.coupon_amount || log.coupon || log.coupon_value ? (
          <div className="flex flex-col leading-tight">
            <span className="font-medium">
              {log.coupon_amount != null ? `$${Number(log.coupon_amount).toFixed(0)}` : log.coupon_value || log.coupon}
            </span>
            {log.coupon && log.coupon_amount != null && (
              <span className="text-[10px] text-muted-foreground">{log.coupon}</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="max-w-[180px] py-2">
        {log.follow_up_needed ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            <BellRing className="h-3 w-3" />
            <span className="line-clamp-1">{log.follow_up_notes || "Follow up"}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-2 text-right text-[10px] text-muted-foreground">
        <div className="flex flex-col items-end leading-tight">
          <span>
            {new Date(log.call_date ?? log.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "2-digit",
            })}
          </span>
          {log.date_source === "auto" && (
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">added</span>
          )}
          {log.date_source === "detected" && (
            <span className="text-[9px] uppercase tracking-wide text-emerald-600">from notes</span>
          )}
        </div>
      </TableCell>
      <TableCell className="py-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </TableCell>
    </TableRow>
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
                {log.customer_id && <span className="font-mono">#{log.customer_id}</span>}
                <span>
                  {new Date(log.call_date ?? log.created_at).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {log.date_source === "auto" && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">(added)</span>
                  )}
                  {log.date_source === "detected" && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-600">(from notes)</span>
                  )}
                </span>
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

          {(log.coupon || log.coupon_value || log.coupon_amount != null) && (
            <Section title="Coupon / discount">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Ticket className="h-4 w-4 text-muted-foreground" />
                {log.coupon_amount != null && (
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                    ${Number(log.coupon_amount).toFixed(2)} credit
                  </span>
                )}
                {log.coupon && <span className="font-medium">{log.coupon}</span>}
                {log.coupon_value && <span className="text-muted-foreground">— {log.coupon_value}</span>}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Enter this amount on Field Routes as a credit toward the customer's next service.
              </p>
            </Section>
          )}

          {log.follow_up_needed && (
            <Section title="Follow-up">
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{log.follow_up_notes || "Follow-up needed."}</span>
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
function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="max-w-none text-[12.5px] leading-relaxed text-foreground/90 [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:uppercase [&_h2]:tracking-wide [&_h2]:text-muted-foreground [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_p]:my-1.5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_a]:text-primary [&_a]:underline">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function ScoreCard({ score, label }: { score: number; label: string }) {
  const tone =
    score >= 80
      ? "from-emerald-500/20 to-emerald-500/5 text-emerald-700 border-emerald-500/30"
      : score >= 60
      ? "from-blue-500/20 to-blue-500/5 text-blue-700 border-blue-500/30"
      : score >= 40
      ? "from-amber-500/20 to-amber-500/5 text-amber-700 border-amber-500/30"
      : "from-rose-500/20 to-rose-500/5 text-rose-700 border-rose-500/30";
  return (
    <div className={cn("rounded-lg border bg-gradient-to-br p-3", tone)}>
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4" />
        <span className="text-[10px] font-semibold uppercase tracking-wide">Agent score</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-3xl font-bold tabular-nums leading-none">{score}</div>
        <div className="text-[10px] text-foreground/60">/ 100</div>
      </div>
      {label && <div className="mt-1 text-[11px] text-foreground/80">{label}</div>}
    </div>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onImport,
  importing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (items: ParsedEntry[]) => void;
  importing: boolean;
}) {
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setEntries([]);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(f: File) {
    setParsing(true);
    setFileName(f.name);
    try {
      const parsed = await parseUploadedFile(f);
      if (parsed.length === 0) toast.error("Couldn't find any call entries in that file");
      setEntries(parsed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse file");
      setEntries([]);
    } finally {
      setParsing(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import call logs</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet (.xlsx, .csv), Word doc (.docx), or text file (.txt, .md).
            The AI will read each entry and organize them under the right date. For Google Sheets or Docs,
            use File → Download in Google Drive to export as .xlsx / .docx, then upload here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <div className="text-sm font-medium">
              {fileName ? fileName : "Choose a file to upload"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              .xlsx · .xls · .csv · .docx · .txt · .md
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.docx,.txt,.md,.tsv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          {parsing && <p className="text-xs text-muted-foreground">Parsing file…</p>}

          {entries.length > 0 && (
            <div className="rounded-lg border">
              <div className="border-b bg-muted/30 px-3 py-1.5 text-[11px] font-medium">
                Preview · {entries.length} {entries.length === 1 ? "entry" : "entries"} found
              </div>
              <div className="max-h-[240px] overflow-auto divide-y">
                {entries.slice(0, 25).map((e, i) => (
                  <div key={i} className="px-3 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {e.callDate
                          ? new Date(e.callDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                          : "No date — will use today"}
                      </span>
                    </div>
                    <div className="line-clamp-2 text-foreground/80">{e.notes}</div>
                  </div>
                ))}
                {entries.length > 25 && (
                  <div className="px-3 py-1.5 text-[11px] text-muted-foreground">
                    …and {entries.length - 25} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={() => onImport(entries)}
            disabled={entries.length === 0 || importing}
          >
            {importing ? (
              <>
                <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
                Analyzing {entries.length}…
              </>
            ) : (
              <>Import {entries.length || ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
