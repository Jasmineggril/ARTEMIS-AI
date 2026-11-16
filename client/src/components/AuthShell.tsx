import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PRODUCT_NAME, PRODUCT_TAGLINE, MODULE_PREDICTIVE, MODULE_MONITORING, SUBMISSION_MODE } from "@shared/identity";
import { ArtemisMark, ArtemisWordmark } from "@/components/ArtemisMark";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex bg-[#F4F7F6] dark:bg-[#0B1513]">
      <aside className="hidden lg:flex lg:w-[42%] flex-col justify-between p-12 text-white bg-gradient-to-br from-[#0B3D2E] via-[#0F5132] to-[#0B2F4A]">
        <button onClick={() => setLocation("/")} className="flex items-center gap-2 text-emerald-200 hover:text-white text-sm font-medium w-fit">
          <ArrowLeft className="w-4 h-4" aria-hidden /> Voltar ao início
        </button>
        <div>
          <ArtemisMark className="w-28 h-28 mb-6" inverted detail="full" />
          <h2 className="text-3xl mb-3">{SUBMISSION_MODE ? <span className="font-bold text-white">{PRODUCT_NAME}</span> : <ArtemisWordmark inverted />}</h2>
          <p className="text-emerald-100 text-lg leading-relaxed mb-8">{PRODUCT_TAGLINE}</p>
          <ul className="space-y-3 text-sm text-emerald-50">
            <li><strong>{MODULE_PREDICTIVE}</strong> — índice explicável do risco de incêndio.</li>
            <li><strong>{MODULE_MONITORING}</strong> — consulta aberta de ocorrências e prevenção.</li>
            <li>Dados de cada organização isolados e auditados.</li>
          </ul>
        </div>
        <p className="text-emerald-300 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" aria-hidden /> Protótipo em validação controlada — não é serviço de emergência.
        </p>
      </aside>
      <main className="flex-1 flex items-center justify-center p-6 relative">
        <button onClick={() => setLocation("/")} className="lg:hidden absolute top-5 left-5 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
          <ArrowLeft className="w-4 h-4" aria-hidden /> Início
        </button>
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <ArtemisMark className="w-10 h-10" />
            {!SUBMISSION_MODE && <ArtemisWordmark className="text-xl" />}
          </div>
          <h1 className="text-2xl font-bold font-display text-slate-900 dark:text-white mb-1">{title}</h1>
          <p className="text-slate-600 dark:text-slate-300 text-sm mb-7">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

export const inputClass =
  "w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-sm";
export const primaryButtonClass =
  "w-full py-3 rounded-xl font-bold text-white text-sm bg-[#0F5132] hover:bg-[#0B3D2E] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600";

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm mb-5">{message}</div>;
}

export function FormNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm mb-5">{message}</div>;
}
