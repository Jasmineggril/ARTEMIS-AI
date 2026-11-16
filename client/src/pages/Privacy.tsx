import { Link } from "wouter";
import { ArtemisMark } from "@/components/ArtemisMark";
import { PRODUCT_NAME, EMERGENCY_NOTICE } from "@shared/identity";

/**
 * Política de privacidade — MINUTA técnica. Deve ser revisada por
 * assessoria jurídica antes de qualquer operação pública (LGPD).
 */
export default function Privacy() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-4 py-10 prose prose-slate dark:prose-invert prose-sm sm:prose-base">
        <Link href="/" className="no-underline flex items-center gap-2 mb-6"><ArtemisMark className="w-8 h-8" /><strong>{PRODUCT_NAME}</strong></Link>
        <h1>Política de Privacidade</h1>
        <p className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-lg p-3 not-prose">
          Minuta em validação jurídica. A plataforma está em fase de protótipo (validação controlada).
        </p>
        <h2>1. Dados tratados</h2>
        <ul>
          <li><strong>Conta:</strong> nome, e-mail e senha (armazenada apenas como hash bcrypt).</li>
          <li><strong>Organização:</strong> áreas monitoradas (nome, município, coordenadas, limites), análises de risco, alertas e arquivos de ocorrências importados.</li>
          <li><strong>Registros de segurança:</strong> trilha de auditoria de operações críticas (usuário, ação, data/hora, endereço IP).</li>
          <li><strong>Relatos ambientais:</strong> descrição, localização e, opcionalmente, identificação do autor.</li>
        </ul>
        <h2>2. Finalidade e base legal (LGPD, art. 7º)</h2>
        <p>Execução do serviço contratado (análise e prevenção de risco de incêndio), cumprimento de obrigações legais e legítimo interesse em segurança e prevenção a fraudes. Dados não são vendidos nem usados para publicidade.</p>
        <h2>3. Isolamento e acesso</h2>
        <p>Os dados de cada organização são acessíveis apenas aos seus membros, conforme o papel atribuído (leitor, analista, gestor, administrador, proprietário). O isolamento é verificado no servidor em toda requisição.</p>
        <h2>4. Compartilhamento</h2>
        <p>Para obter dados meteorológicos, apenas as coordenadas da área são enviadas ao Open-Meteo, sem identificação do usuário. Nenhum dado é encaminhado a órgãos públicos sem integração formal e autorização.</p>
        <h2>5. Retenção</h2>
        <p>Dados da conta e da organização são mantidos enquanto a conta estiver ativa. Registros de auditoria: 12 meses (proposta). Tokens de redefinição de senha expiram em 30 minutos.</p>
        <h2>6. Direitos do titular</h2>
        <p>Confirmação, acesso, correção, anonimização, portabilidade e eliminação, mediante solicitação ao encarregado (contato institucional a definir).</p>
        <h2>7. Segurança</h2>
        <p>Comunicação via HTTPS, cookies de sessão HttpOnly/SameSite, limitação de tentativas, validação de entradas e backups criptografados.</p>
        <p className="not-prose text-sm bg-red-50 text-red-900 border border-red-200 rounded-lg p-3">{EMERGENCY_NOTICE}</p>
      </div>
    </main>
  );
}
