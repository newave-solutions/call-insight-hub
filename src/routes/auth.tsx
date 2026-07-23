import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PhoneCall, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in · CallInsight" },
      { name: "description", content: "Sign in to track and analyze your retention calls." },
    ],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/dashboard" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  function validateInputs(): boolean {
    const newErrors: string[] = [];

    if (!email || !email.includes("@")) {
      newErrors.push("Please enter a valid email address");
    }

    if (!password || password.length < 6) {
      newErrors.push("Password must be at least 6 characters");
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        newErrors.push("Passwords do not match");
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();

    if (!validateInputs()) {
      return;
    }

    setLoading(true);
    setErrors([]);

    try {
      if (mode === "signup") {
        const { error, data } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });

        if (error) {
          throw error;
        }

        if (data?.user?.identities?.length === 0) {
          setErrors(["This email is already registered. Please sign in instead."]);
          setMode("signin");
          return;
        }

        toast.success("Account created! Check your email to confirm.");
        setEmail("");
        setPassword("");
        setConfirmPassword("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
          if (error.message.includes("Invalid login credentials")) {
            setErrors(["Invalid email or password"]);
          } else {
            throw error;
          }
          return;
        }

        toast.success("Signed in successfully!");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setErrors([message]);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    setErrors([]);

    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });

      if (result.error) {
        const message = result.error.message ?? "Google sign-in failed";
        setErrors([message]);
        toast.error(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setErrors([message]);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-accent/20 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <PhoneCall className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">CallInsight</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            AI-powered retention call tracking
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          {errors.length > 0 && (
            <div className="mb-4 flex gap-3 rounded-lg bg-destructive/10 p-3 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive mt-0.5" />
              <div className="space-y-1">
                {errors.map((error, i) => (
                  <p key={i} className="text-destructive">
                    {error}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6 flex gap-2 rounded-lg bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setErrors([]);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === "signin" ? "bg-background shadow" : "text-muted-foreground"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setErrors([]);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                mode === "signup" ? "bg-background shadow" : "text-muted-foreground"
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleEmail} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="your@email.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              />
            </div>

            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  placeholder="Confirm your password"
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Processing..." : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            OR
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={loading}
          >
            {loading ? "Processing..." : "Continue with Google"}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:underline">
            Back home
          </Link>
        </p>
      </div>
    </div>
  );
}
