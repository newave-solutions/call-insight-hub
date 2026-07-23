import { useRef, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowUp, CalendarIcon, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";

interface CallAnalysisFormProps {
  notes: string;
  onNotesChange: (notes: string) => void;
  callDate: Date;
  onCallDateChange: (date: Date) => void;
  onSubmit: () => void;
  onUploadClick: () => void;
  isLoading: boolean;
}

export function CallAnalysisForm({
  notes,
  onNotesChange,
  callDate,
  onCallDateChange,
  onSubmit,
  onUploadClick,
  isLoading,
}: CallAnalysisFormProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const trimmed = notes.trim();
    if (trimmed.length < 5) {
      toast.error("Please enter at least 5 characters");
      return;
    }
    onSubmit();
  };

  return (
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
                  if (d) onCallDateChange(d);
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
                    onCallDateChange(d);
                    setDateOpen(false);
                  }}
                >
                  Yesterday
                </button>
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => {
                    onCallDateChange(new Date());
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
            onClick={onUploadClick}
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
        </div>
      </div>

      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSubmit();
          }}
          placeholder="Paste call notes… e.g. 'Jane Doe #A-2201 wanted to cancel. Offered 50% off next regular service ($60 credit). Signed new 12mo agreement at $120/service.'"
          className="min-h-[120px] resize-none rounded-lg border bg-background pr-12 text-sm"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={isLoading || notes.trim().length < 5}
          className="absolute bottom-2 right-2 h-8 w-8 rounded-lg"
        >
          {isLoading ? <Sparkles className="h-4 w-4 animate-pulse" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
      </div>

      <p className="mt-1.5 text-[10px] text-muted-foreground">
        ⌘/Ctrl + Enter to submit · Call date defaults to today — change it above if the call was
        from a different day. AI still extracts a date it finds in your notes.
      </p>
    </div>
  );
}
