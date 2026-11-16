import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArtemisMark, ArtemisWordmark } from "@/components/ArtemisMark";
import { PRODUCT_TAGLINE, SUBMISSION_MODE, PRODUCT_NAME, TRL_LABEL } from "@shared/identity";

/** Full-screen loading state with the brand (pulse only when motion is allowed). */
export function BrandSplash({ message = "Carregando…" }: { message?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[#F5F8F6]" role="status" aria-live="polite">
      <ArtemisMark className="w-20 h-20 motion-safe:animate-pulse" detail="full" />
      {!SUBMISSION_MODE && <ArtemisWordmark className="text-xl" />}
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  );
}

/** Shown only when printing / saving as PDF (reports, analyses). */
export function PrintBrandHeader() {
  return (
    <div className="hidden print:flex items-center justify-between border-b border-slate-300 pb-3 mb-6">
      <div className="flex items-center gap-3">
        <ArtemisMark className="w-10 h-10" />
        <div>
          {SUBMISSION_MODE ? <strong>{PRODUCT_NAME}</strong> : <ArtemisWordmark className="text-lg" />}
          <p className="text-[10px] text-slate-600">{PRODUCT_TAGLINE}</p>
        </div>
      </div>
      <div className="text-right text-[10px] text-slate-600">
        <p>Documento gerado em {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
        <p>{typeof window !== "undefined" ? window.location.host : ""} · {TRL_LABEL}</p>
        <p>Apoio à decisão — não substitui laudo técnico nem protocolo oficial.</p>
      </div>
    </div>
  );
}

/** Branded 404. */
export function BrandNotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#061A14] text-white px-4">
      <div className="max-w-md text-center">
        <ArtemisMark className="w-24 h-24 mx-auto" inverted detail="full" />
        <p className="mt-6 text-sm font-semibold text-emerald-300 tracking-widest">ERRO 404</p>
        <h1 className="mt-2 text-3xl font-bold font-display text-white">Página não encontrada</h1>
        <p className="mt-3 text-emerald-50/80">O endereço pode ter mudado ou não existe. Use um dos caminhos abaixo.</p>
        <nav className="mt-8 flex flex-col sm:flex-row gap-3 justify-center" aria-label="Caminhos sugeridos">
          <Link href="/" className="rounded-xl bg-orange-400 px-5 py-3 font-semibold text-[#1c0a00] hover:bg-orange-300">Página inicial</Link>
          <Link href="/consulta-publica" className="rounded-xl border border-white/25 px-5 py-3 font-semibold hover:bg-white/10">Consulta pública</Link>
          <Link href="/dashboard" className="rounded-xl border border-white/25 px-5 py-3 font-semibold hover:bg-white/10">Painel</Link>
        </nav>
      </div>
    </main>
  );
}
