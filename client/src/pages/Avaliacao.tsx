/**
 * System Usability Scale (SUS — Brooke, 1996), Portuguese wording.
 * 10 statements, 1 (discordo totalmente) – 5 (concordo totalmente); score 0–100 calculated on the server.
 */
import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

const ITEMS = [
  "Eu acho que gostaria de usar este sistema com frequência.",
  "Eu achei o sistema desnecessariamente complexo.",
  "Eu achei o sistema fácil de usar.",
  "Eu acho que precisaria do apoio de um suporte técnico para conseguir usar este sistema.",
  "Eu achei que as várias funções do sistema estão bem integradas.",
  "Eu achei que o sistema apresenta muita inconsistência.",
  "Eu imagino que a maioria das pessoas aprenderia a usar este sistema rapidamente.",
  "Eu achei o sistema muito complicado de usar.",
  "Eu me senti muito confiante usando o sistema.",
  "Eu precisei aprender muitas coisas antes de conseguir usar o sistema.",
];

export default function Avaliacao() {
  const [answers, setAnswers] = useState<(number | null)[]>(Array(10).fill(null));
  const [comment, setComment] = useState("");
  const [state, setState] = useState<{ busy?: boolean; score?: number; err?: string }>({});
  const complete = answers.every((a) => a !== null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const r = await api<{ score: number }>("POST", "/api/sus", { answers, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setState({ score: r.score });
    } catch (err) {
      setState({ err: err instanceof ApiError ? err.message : "Não foi possível enviar." });
    }
  }

  return (
    <Layout>
      <h1 className="text-3xl font-bold font-display flex items-center gap-2 mb-1"><ClipboardCheck className="w-8 h-8 text-primary" aria-hidden />Avaliação de usabilidade</h1>
      <p className="text-muted-foreground text-sm mb-6 max-w-2xl">Questionário padrão SUS (System Usability Scale), com 10 afirmações. Responda pensando no seu uso da ARTEMIS AI. As respostas ajudam a medir e melhorar a plataforma.</p>
      {state.score !== undefined ? (
        <div role="status" className="rounded-2xl border bg-card p-6 max-w-xl">
          <p className="font-semibold">Obrigado pela avaliação!</p>
          <p className="text-sm text-muted-foreground mt-1">Pontuação SUS desta resposta: <strong className="text-foreground">{state.score.toFixed(1)}</strong> de 100.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 max-w-3xl" data-testid="form-sus">
          {ITEMS.map((t, i) => (
            <fieldset key={i} className="rounded-xl border bg-card p-4">
              <legend className="text-sm font-medium px-1">{i + 1}. {t}</legend>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground w-28">Discordo totalmente</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className={`w-9 h-9 rounded-full border flex items-center justify-center text-sm cursor-pointer ${answers[i] === n ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                    <input type="radio" name={`sus-${i}`} value={n} checked={answers[i] === n} onChange={() => setAnswers((a) => a.map((x, j) => (j === i ? n : x)))} className="sr-only" aria-label={`${n}`} />{n}
                  </label>))}
                <span className="text-xs text-muted-foreground w-28">Concordo totalmente</span>
              </div>
            </fieldset>
          ))}
          <div><label htmlFor="sus-c" className="text-sm font-medium block mb-1">Comentário (opcional)</label>
            <textarea id="sus-c" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} className="w-full rounded-lg border border-input bg-background p-2 text-sm h-24" /></div>
          {state.err && <p role="alert" className="text-sm text-red-700">{state.err}</p>}
          <Button type="submit" disabled={!complete || state.busy}>{state.busy ? "Enviando…" : complete ? "Enviar avaliação" : `Responda às 10 afirmações (${answers.filter((a) => a !== null).length}/10)`}</Button>
        </form>
      )}
    </Layout>
  );
}
