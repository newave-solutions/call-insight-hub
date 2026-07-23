import { useState } from "react";
import { X, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/outcome-validation";
import { ALL_CATEGORIES, CATEGORY_META } from "@/routes/_authenticated/dashboard";

interface OutcomeEditorProps {
  log: any;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
  saving: boolean;
}

export function OutcomeEditor({ log, onClose, onSave, saving }: OutcomeEditorProps) {
  const [editing, setEditing] = useState(false);
  const [selectedOutcomes, setSelectedOutcomes] = useState<Category[]>(
    Array.isArray(log.categories) && log.categories.length > 0
      ? (log.categories as Category[])
      : ([log.category] as Category[])
  );
  const [form, setForm] = useState({
    customer_name: log.customer_name ?? "",
    customer_id: log.customer_id ?? "",
    service_name: log.service_name ?? "",
    price_per_service: log.price_per_service != null ? String(log.price_per_service) : "",
    agreement_length_months: log.agreement_length_months != null ? String(log.agreement_length_months) : "",
    coupon: log.coupon ?? "",
    coupon_value: log.coupon_value ?? "",
    coupon_amount: log.coupon_amount != null ? String(log.coupon_amount) : "",
    follow_up_needed: log.follow_up_needed,
    follow_up_notes: log.follow_up_notes ?? "",
  });

  const handleOutcomeToggle = (outcome: Category) => {
    setSelectedOutcomes((prev) => {
      if (prev.includes(outcome)) {
        return prev.filter((o) => o !== outcome);
      }
      return [...prev, outcome];
    });
  };

  async function save() {
    // Validate outcomes
    if (selectedOutcomes.length === 0) {
      alert("Please select at least one outcome");
      return;
    }

    // Prevent "Other" only selection if other outcomes could apply
    if (selectedOutcomes.length === 1 && selectedOutcomes[0] === "other") {
      if (!window.confirm("Are you sure you want to categorize this as 'Other'? Please verify the call doesn't fit better into another category.")) {
        return;
      }
    }

    const patch: Record<string, unknown> = {
      customer_name: form.customer_name.trim() || null,
      customer_id: form.customer_id.trim() || null,
      categories: selectedOutcomes,
      category: selectedOutcomes[0],
      service_name: form.service_name.trim() || null,
      price_per_service: form.price_per_service ? Number(form.price_per_service) : null,
      agreement_length_months: form.agreement_length_months ? parseInt(form.agreement_length_months, 10) : null,
      coupon: form.coupon.trim() || null,
      coupon_value: form.coupon_value.trim() || null,
      coupon_amount: form.coupon_amount ? Number(form.coupon_amount) : null,
      follow_up_needed: form.follow_up_needed,
      follow_up_notes: form.follow_up_needed ? form.follow_up_notes.trim() || null : null,
    };

    await onSave(patch);
    setEditing(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{log.customer_name || "Unnamed customer"}</h2>
            <p className="text-xs text-muted-foreground mt-1">Edit call outcomes and details</p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {editing ? (
          <div className="mt-6 space-y-4">
            {/* Outcomes Selection */}
            <div className="border rounded-lg p-4">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Call Outcomes</h3>
                <Badge variant="outline" className="text-[10px]">
                  Select at least one
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(ALL_CATEGORIES as Category[]).map((cat) => {
                  const meta = CATEGORY_META[cat];
                  return (
                    <label
                      key={cat}
                      className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedOutcomes.includes(cat)}
                        onCheckedChange={() => handleOutcomeToggle(cat)}
                      />
                      <span className="text-xs font-medium">{meta.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Agreement Details */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Agreement Details
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Service
                  </label>
                  <Input
                    value={form.service_name}
                    onChange={(e) => setForm({ ...form, service_name: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Price / Service
                  </label>
                  <Input
                    inputMode="decimal"
                    value={form.price_per_service}
                    onChange={(e) => setForm({ ...form, price_per_service: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Agreement (Months)
                  </label>
                  <Input
                    inputMode="numeric"
                    value={form.agreement_length_months}
                    onChange={(e) => setForm({ ...form, agreement_length_months: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Coupon/Refund Details */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Coupon / Refund Details
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Coupon
                  </label>
                  <Input
                    value={form.coupon}
                    onChange={(e) => setForm({ ...form, coupon: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Coupon Value
                  </label>
                  <Input
                    value={form.coupon_value}
                    onChange={(e) => setForm({ ...form, coupon_value: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Coupon Amount ($)
                  </label>
                  <Input
                    inputMode="decimal"
                    value={form.coupon_amount}
                    onChange={(e) => setForm({ ...form, coupon_amount: e.target.value })}
                    placeholder="0.00"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Follow-up */}
            <div className="rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.follow_up_needed}
                  onChange={(e) => setForm({ ...form, follow_up_needed: e.target.checked })}
                />
                Follow-up needed
              </label>
              {form.follow_up_needed && (
                <Textarea
                  value={form.follow_up_notes}
                  onChange={(e) => setForm({ ...form, follow_up_notes: e.target.value })}
                  placeholder="What is pending? Who is following up?"
                  className="mt-2 min-h-[60px]"
                />
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {/* Display Selected Outcomes */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Outcomes
              </h3>
              <div className="flex flex-wrap gap-2">
                {selectedOutcomes.map((outcome) => {
                  const meta = CATEGORY_META[outcome as Category];
                  return (
                    <Badge key={outcome} className={cn(meta.color)}>
                      {meta.label}
                    </Badge>
                  );
                })}
              </div>
            </div>

            {/* Display Agreement Details */}
            {(form.service_name || form.price_per_service || form.agreement_length_months) && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Agreement Details
                </h3>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {form.service_name && (
                    <div className="rounded-lg border bg-card/60 px-3 py-2">
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Service
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium">{form.service_name}</dd>
                    </div>
                  )}
                  {form.price_per_service && (
                    <div className="rounded-lg border bg-card/60 px-3 py-2">
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Price / Service
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium">${form.price_per_service}</dd>
                    </div>
                  )}
                  {form.agreement_length_months && (
                    <div className="rounded-lg border bg-card/60 px-3 py-2">
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Agreement
                      </dt>
                      <dd className="mt-0.5 text-sm font-medium">{form.agreement_length_months} months</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* Display Coupon Details */}
            {(form.coupon || form.coupon_value || form.coupon_amount) && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Coupon / Discount
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {form.coupon_amount && (
                    <Badge variant="secondary">${form.coupon_amount} credit</Badge>
                  )}
                  {form.coupon && <span className="font-medium">{form.coupon}</span>}
                  {form.coupon_value && <span className="text-muted-foreground">— {form.coupon_value}</span>}
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              className="w-full gap-2"
            >
              <Pencil className="h-4 w-4" />
              Edit Outcomes & Details
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
