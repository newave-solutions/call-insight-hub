import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  authErrorMessage,
  signInSchema,
  signUpSchema,
  type SignInValues,
  type SignUpValues,
} from "@/lib/auth-schemas";

type Mode = "signin" | "signup";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-destructive">{message}</p>;
}

export function EmailAuthForm({ mode }: { mode: Mode }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState<string | null>(null);

  const signIn = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur",
  });

  const signUp = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
    mode: "onBlur",
  });

  // Clear cross-mode state when the user toggles tabs.
  useEffect(() => {
    setFormError(null);
    setConfirmSent(null);
  }, [mode]);

  const onSignIn = signIn.handleSubmit(async ({ email, password }) => {
    setFormError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const message = authErrorMessage(error);
      setFormError(message);
      toast.error(message);
      return;
    }
    toast.success("Welcome back");
    // Redirect is handled by the auth state listener on the auth route.
  });

  const onSignUp = signUp.handleSubmit(async ({ email, password }) => {
    setFormError(null);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      const message = authErrorMessage(error);
      setFormError(message);
      toast.error(message);
      return;
    }
    if (!data.session) {
      setConfirmSent(email);
      toast.success("Check your email to confirm your account.");
      signUp.reset();
    }
  });

  const busy = mode === "signin" ? signIn.formState.isSubmitting : signUp.formState.isSubmitting;

  if (mode === "signup" && confirmSent) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed bg-muted/40 p-4 text-center">
        <p className="text-sm font-medium">Confirm your email</p>
        <p className="text-xs text-muted-foreground">
          We sent a confirmation link to <span className="font-medium">{confirmSent}</span>. Open it
          to finish creating your account.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmSent(null)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={mode === "signin" ? onSignIn : onSignUp}
      className="space-y-4"
      aria-busy={busy}
    >
      {mode === "signin" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="signin-email">Email</Label>
            <Input
              id="signin-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!signIn.formState.errors.email}
              {...signIn.register("email")}
            />
            <FieldError message={signIn.formState.errors.email?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signin-password">Password</Label>
            <Input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!signIn.formState.errors.password}
              {...signIn.register("password")}
            />
            <FieldError message={signIn.formState.errors.password?.message} />
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!signUp.formState.errors.email}
              {...signUp.register("email")}
            />
            <FieldError message={signUp.formState.errors.email?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!signUp.formState.errors.password}
              {...signUp.register("password")}
            />
            <FieldError message={signUp.formState.errors.password?.message} />
            <p className="text-xs text-muted-foreground">
              At least 8 characters, including a letter and a number.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="signup-confirm">Confirm password</Label>
            <Input
              id="signup-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!signUp.formState.errors.confirmPassword}
              {...signUp.register("confirmPassword")}
            />
            <FieldError message={signUp.formState.errors.confirmPassword?.message} />
          </div>
        </>
      )}

      {formError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {mode === "signup" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}