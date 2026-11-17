/** "Enviar opinião": problems, suggestions, praise or questions, from any screen (signed-in users). */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";
import { MessageSquarePlus, X, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { useAuthStatus } from "@/hooks/use-auth";

const CATS = [["problema", "Problema"], ["sugestao", "Sugestão"], ["duvida", "Dúvida"], ["elogio", "Elogio"]] as const;

export function FeedbackButton() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("problema");
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  const { data: user } = useAuthStatus();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api<{ message: string }>("POST", "/api/feedback", { page: location, category, message: message.trim(), ...(rating ? { rating } : {}) });
      setState({ ok: r.message });
      setMessage(""); setRating(null);
    } catch (err) {
      setState({ err: err instanceof ApiError ? err.message : "Não foi possível enviar." });
    }
  }

  if (!user) return null;
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setState({}); }} data-testid="button-feedback"
        className="fixed bottom-5 right-5 z-40 print:hidden inline-flex items-center gap-2 rounded-full bg-card border shadow-lg px-4 py-2.5 text-sm font-medium hover:bg-secondary">
        <MessageSquarePlus className="w-4 h-4 text-primary" aria-hidden />Enviar opinião
      </button>
      {open && createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="fb-title" className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={send} className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 id="fb-title" className="font-bold">Enviar opinião</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="p-2 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
            </div>
            {state.ok ? (
              <div className="space-y-3">
                <p role="status" className="text-sm text-emerald-800">{state.ok}</p>
                <p className="text-sm">Se puder, responda também ao <Link href="/avaliacao" className="underline" onClick={() => setOpen(false)}>questionário de usabilidade</Link> (10 afirmações, 2 minutos).</p>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
              </div>
            ) : (
              <>
                <fieldset><legend className="text-sm font-medium mb-1">Tipo</legend>
                  <div className="flex flex-wrap gap-2">{CATS.map(([k, l]) => (
                    <label key={k} className={`text-sm rounded-full border px-3 py-1 cursor-pointer ${category === k ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                      <input type="radio" name="fb-cat" value={k} checked={category === k} onChange={() => setCategory(k)} className="sr-only" />{l}</label>))}</div>
                </fieldset>
                <fieldset><legend className="text-sm font-medium mb-1">Sua nota para esta tela (opcional)</legend>
                  <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-label={`${n} de 5`} aria-pressed={rating === n} onClick={() => setRating(rating === n ? null : n)} className="p-1">
                      <Star className={`w-6 h-6 ${rating && n <= rating ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} aria-hidden /></button>))}</div>
                </fieldset>
                <div><label htmlFor="fb-msg" className="text-sm font-medium block mb-1">Mensagem</label>
                  <textarea id="fb-msg" required minLength={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background p-2 text-sm h-28" placeholder="O que aconteceu, o que esperava, ou sua sugestão." /></div>
                <p className="text-xs text-muted-foreground">Registramos a tela ({location}) e sua conta, para podermos responder. Não inclua senhas.</p>
                {state.err && <p role="alert" className="text-sm text-red-700">{state.err}</p>}
                <Button type="submit" disabled={state.busy || message.trim().length < 3}>{state.busy ? "Enviando…" : "Enviar"}</Button>
              </>
            )}
          </form>
        </div>, document.body)}
    </>
  );
}
