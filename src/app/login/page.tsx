"use client";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Leaf, Eye, EyeOff, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { toast } = useToast();

  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user) {
      router.replace("/dashboard");
    }
  }, [sessionStatus, session, router]);

  if (sessionStatus === "loading" || sessionStatus === "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password. Please try again.");
      return;
    }
    toast({ title: "Logged in", description: "Welcome back." });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Soft primary ambient backlight */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background: "radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in srgb, var(--primary) 9%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="w-full max-w-md space-y-6 relative">
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-4 animate-page-enter">
          <div className="relative">
            <div className="clay-brand-mark size-16 rounded-2xl bg-primary/12 border border-primary/25 flex items-center justify-center">
              <Leaf className="size-7 text-primary" aria-hidden />
            </div>
            {/* Glow ring */}
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              aria-hidden
              style={{ boxShadow: "var(--clay-raised-sm)" }}
            />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              GrowPlants<span className="text-primary"> Media</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Private media infrastructure
            </p>
          </div>
        </div>

        {/* Login card */}
        <div
          className="clay-panel animate-page-enter overflow-hidden rounded-[24px]"
          style={{ "--enter-delay": "80ms" } as React.CSSProperties}
        >
          <div className="px-6 pt-6 pb-2 border-b border-border">
            <h2 className="text-base font-semibold">Sign in</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Enter your admin credentials to continue.</p>
          </div>
          <div className="px-6 py-6">
            <form onSubmit={onSubmit} className="space-y-4" id="login-form">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  autoFocus
                  className="bg-muted/40 border-border focus:border-ring transition-colors h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="pr-10 bg-muted/40 border-border focus:border-ring transition-colors h-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 size-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </Button>
                </div>
              </div>

              {error && (
                <Alert variant="destructive" className="animate-page-enter py-3">
                  <AlertCircle className="size-4" aria-hidden />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold transition-all duration-150 mt-2"
              >
                {loading && <Loader2 className="size-4 animate-spin mr-2" aria-hidden />}
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>
        </div>

        <p
          className="text-xs text-center text-muted-foreground/60 animate-page-enter"
          style={{ "--enter-delay": "140ms" } as React.CSSProperties}
        >
          Private admin access · Encrypted storage session
        </p>
      </div>
    </div>
  );
}
