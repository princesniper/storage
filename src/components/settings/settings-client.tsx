"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Phone, ShieldCheck, ShieldAlert, LogOut, Key, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/ui/page-header";
import { StorageStatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  adminEmail: string;
  storageStatus: string;
  storageError?: string;
  phoneReference?: string;
  lastConnectedAt?: string;
}

type Step = "idle" | "phone" | "code" | "2fa";
const STEPS: { id: Exclude<Step, "idle">; label: string }[] = [
  { id: "phone", label: "Phone" },
  { id: "code", label: "Code" },
  { id: "2fa", label: "2FA" },
];

export default function SettingsClient({ adminEmail, storageStatus, storageError, phoneReference, lastConnectedAt }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(storageStatus === "connected" ? "idle" : "phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [password2fa, setPassword2fa] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const connected = storageStatus === "connected";

  async function requestCode() {
    setBusy(true);
    try {
      const r = await fetch("/api/telegram/connect/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Failed to send code");
      setPhoneCodeHash(json.phoneCodeHash);
      setStep("code");
      toast({ title: "Code sent", description: "Check your configured authentication method." });
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setBusy(true);
    try {
      const r = await fetch("/api/telegram/connect/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, phoneCodeHash }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Verification failed");
      if (json.needs2fa) {
        setStep("2fa");
        toast({ title: "2FA required", description: "Enter your security password." });
      } else {
        toast({ title: "Connected", description: "Storage account linked successfully." });
        setStep("phone");
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function verify2fa() {
    setBusy(true);
    try {
      const r = await fetch("/api/telegram/connect/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password2fa }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "2FA failed");
      toast({ title: "Connected", description: "Storage account linked successfully." });
      setStep("phone");
      setPassword2fa("");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      const r = await fetch("/api/telegram/disconnect", { method: "POST" });
      if (!r.ok) throw new Error("Failed to disconnect");
      toast({ title: "Disconnected" });
      window.location.reload();
    } catch (e) {
      toast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Settings"
        description="Account, storage connection and system information."
      />

      {/* Account */}
      <Card className="animate-page-enter">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="size-4" aria-hidden /> Admin Account
          </CardTitle>
          <CardDescription>Single-admin access. Credentials are configured via server environment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Email</span>
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded-md">{adminEmail}</code>
          </div>
        </CardContent>
      </Card>

      {/* Storage connection */}
      <Card className="animate-page-enter" style={{ "--enter-delay": "60ms" } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="size-4" aria-hidden /> Storage Connection
          </CardTitle>
          <CardDescription>
            Your Storage account is used as the storage backend. The session is encrypted at rest and never sent to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2">
              {connected ? (
                <ShieldCheck className="size-4 text-emerald-500" aria-hidden />
              ) : (
                <ShieldAlert className="size-4 text-amber-500" aria-hidden />
              )}
              <span className="text-sm font-medium">Status</span>
              <StorageStatusBadge status={storageStatus} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {phoneReference && <span>Reference: <Badge variant="outline" className="font-mono">{phoneReference}</Badge></span>}
              {lastConnectedAt && <span>Last connected: {formatDateTime(lastConnectedAt)}</span>}
            </div>
          </div>

          {storageError && (
            <Alert variant="destructive">
              <AlertTitle>Storage error</AlertTitle>
              <AlertDescription>Unable to access storage. Please try again.</AlertDescription>
            </Alert>
          )}

          {connected ? (
            <div className="flex items-center gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={disconnecting}>
                    <LogOut className="size-4 mr-2" aria-hidden /> Disconnect
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect storage?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You will need to re-authenticate to upload again. Existing public URLs remain available when the storage service is restored.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={disconnect}
                    >
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : (
            <div className="space-y-5 rounded-xl border border-border p-4 md:p-5">
              <StepIndicator current={step} />
              {step === "phone" && (
                <div className="space-y-3 animate-page-enter">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Storage account identifier</Label>
                    <Input
                      id="phone"
                      placeholder="Storage account identifier"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      className="font-mono"
                      onKeyDown={(e) => e.key === "Enter" && phone && requestCode()}
                    />
                  </div>
                  <Button onClick={requestCode} disabled={busy || !phone}>
                    {busy && <Loader2 className="size-4 animate-spin mr-2" aria-hidden />}
                    Send Code
                  </Button>
                </div>
              )}
              {step === "code" && (
                <div className="space-y-3 animate-page-enter">
                  <div className="space-y-2">
                    <Label htmlFor="code">Verification Code</Label>
                    <Input
                      id="code"
                      placeholder="12345"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      maxLength={6}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      className="font-mono tracking-[0.3em] text-center text-lg"
                      onKeyDown={(e) => e.key === "Enter" && code && verifyCode()}
                    />
                    <p className="text-xs text-muted-foreground">Sent using your configured authentication method. Check your authentication method or SMS.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={verifyCode} disabled={busy || !code}>
                      {busy && <Loader2 className="size-4 animate-spin mr-2" aria-hidden />}
                      Verify Code
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setStep("phone")}>← Back</Button>
                  </div>
                </div>
              )}
              {step === "2fa" && (
                <div className="space-y-3 animate-page-enter">
                  <div className="space-y-2">
                    <Label htmlFor="2fa">Security Password</Label>
                    <Input
                      id="2fa"
                      type="password"
                      value={password2fa}
                      onChange={(e) => setPassword2fa(e.target.value)}
                      autoComplete="current-password"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && password2fa && verify2fa()}
                    />
                    <p className="text-xs text-muted-foreground">Additional verification is required for this storage account.</p>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={verify2fa} disabled={busy || !password2fa}>
                      {busy && <Loader2 className="size-4 animate-spin mr-2" aria-hidden />}
                      Submit 2FA
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setStep("code")}>← Back</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {!connected && (
            <p className="text-xs text-muted-foreground">
              Tip: Get <code className="font-mono mx-1">api_id</code> and <code className="font-mono mx-1">api_hash</code> from{" "}
              <a className="underline underline-offset-2" href="https://example.invalid" target="_blank" rel="noreferrer">your storage provider</a>{" "}
              and set them in the server <code className="font-mono">.env</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Alert className="animate-page-enter" style={{ "--enter-delay": "120ms" } as React.CSSProperties}>
        <ShieldAlert className="size-4" aria-hidden />
        <AlertTitle>About using a personal Storage account as storage</AlertTitle>
        <AlertDescription>
          Your storage connection is encrypted at rest and managed by the application. Keep your account credentials secure and maintain a database backup.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const order: Step[] = ["phone", "code", "2fa"];
  const currentIdx = order.indexOf(current);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Connection progress">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = s.id === current;
        // 2FA only applies when required; show it muted until reached
        return (
          <li key={s.id} className="flex items-center gap-1.5 flex-1 last:flex-none">
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-6 rounded-full text-[11px] font-semibold flex items-center justify-center transition-all duration-200 shrink-0",
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                )}
                aria-hidden
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={cn("text-xs hidden sm:inline", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span className={cn("h-px flex-1 mx-1 transition-colors", done ? "bg-emerald-500" : "bg-border")} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
