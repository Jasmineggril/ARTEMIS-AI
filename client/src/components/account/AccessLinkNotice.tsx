/** Shows a single-use account link ONCE (when e-mail is not configured), with copy button. */
import { useState } from "react";
import { format } from "date-fns";
import { Copy, Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AccessLink { link?: string; expiresAt: string; emailed: boolean }

export function AccessLinkNotice({ who, access, onClose }: { who: string; access: AccessLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-950 p-4 text-sm space-y-2" data-testid="access-link-notice">
      <p className="font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" aria-hidden />Link de acesso para {who}</p>
      {access.emailed ? (
        <p>Enviado por e-mail. Vale até {format(new Date(access.expiresAt), "dd/MM/yyyy HH:mm")} e só pode ser usado uma vez.</p>
      ) : (
        <>
          <p>O envio de e-mail não está ativo. Copie o link e envie à pessoa por um canal seguro (ele aparece só agora).
            Vale até {format(new Date(access.expiresAt), "dd/MM/yyyy HH:mm")} e só pode ser usado uma vez.</p>
          <div className="flex gap-2">
            <input readOnly aria-label="Link de acesso" value={access.link} className="flex-1 min-w-0 rounded-lg border border-emerald-300 bg-white px-2 py-1.5 font-mono text-xs" data-testid="access-link" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(access.link!); setCopied(true); } catch { /* manual copy */ } }}>
              {copied ? <><Check className="w-4 h-4 mr-1" aria-hidden />Copiado</> : <><Copy className="w-4 h-4 mr-1" aria-hidden />Copiar</>}
            </Button>
          </div>
        </>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
    </div>
  );
}
