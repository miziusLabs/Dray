import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/Avatar";
import type { AccountStatus } from "@/types/events";

export default function ChatGptAccount() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState<"signin" | "signout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const subscription = listen<AccountStatus>("account_changed", ({ payload }) => {
      if (disposed) return;
      setAccount(payload); setError(payload.error); setBusy(null);
    });
    invoke<AccountStatus>("get_account_status").then((value) => {
      if (!disposed) setAccount(value);
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; void subscription.then((unlisten) => unlisten()); };
  }, []);

  async function signIn() {
    setError(null); setBusy("signin");
    try { await invoke("sign_in_chatgpt"); }
    catch (reason) { setError(String(reason)); setBusy(null); }
  }
  async function signOut() {
    setBusy("signout"); setError(null);
    try { await invoke("sign_out_chatgpt"); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            key={account?.picture ?? account?.email ?? "signed-out"}
            src={account?.signedIn ? account.picture : null}
            name={account?.signedIn ? account.email ?? "ChatGPT" : "ChatGPT"}
            className="size-9 text-ui"
          />
          <div className="min-w-0">
            <p className="text-ui font-medium">ChatGPT account</p>
            <p className="text-ui text-muted-foreground break-words">
              {account?.signedIn ? account.email ?? "Connected to ChatGPT" : "Connect ChatGPT to use Dray’s built-in coding agent."}
            </p>
          </div>
        </div>
        {busy === "signin" ? (
          <Button
            size="sm"
            className="text-ui"
            variant="outline"
            onClick={() => {
              void invoke("cancel_chatgpt_sign_in")
                .then(() => setBusy(null))
                .catch((reason) => setError(String(reason)));
            }}
          >
            Cancel
          </Button>
        ) : account?.signedIn ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" className="text-ui" disabled={busy !== null} variant="outline" onClick={() => void signIn()}>
              Reconnect
            </Button>
            <Button size="sm" className="text-ui" disabled={busy !== null} variant="outline" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        ) : (
          <Button size="sm" className="text-ui" variant="outline" disabled={busy !== null} onClick={() => void signIn()}>
            Continue with ChatGPT
          </Button>
        )}
      </div>
      {busy === "signin" && <p className="text-xs text-muted-foreground">Complete sign-in in your browser.</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
