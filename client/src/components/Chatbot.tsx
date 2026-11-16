import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Bot, X, Send, Flame, AlertTriangle, Info, Loader2, Wifi, WifiOff, Trash2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIMULATED_DATA_LABEL, PRODUCT_NAME } from "@shared/identity";
import ReactMarkdown from "react-markdown";
import { getLocationContextFromText, getCityLevelLocationContext } from "@/lib/biomes";

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
  usedFallback?: boolean;
}

type HistoryItem = { role: "user" | "assistant"; content: string };

type PropertyProfile = {
  municipality?: string;
  state?: string;
  biome?: string;
  propertySize?: string;
};

const QUICK_QUESTIONS = [
  "O que significa risco crítico de incêndio?",
  "Quais fatores mais influenciam o risco?",
  "O que fazer com risco alto na área?",
  "O que são dados simulados nesta plataforma?",
];

const PROPERTY_PROFILE_LS_KEY = "artemis_property_profile";

function loadProfileFromStorage(): PropertyProfile {
  try {
    const raw = localStorage.getItem(PROPERTY_PROFILE_LS_KEY);
    if (raw) return JSON.parse(raw) as PropertyProfile;
  } catch {
    // ignore parse errors
  }
  return {};
}

function saveProfileToStorage(profile: PropertyProfile): void {
  try {
    if (Object.keys(profile).length === 0) {
      localStorage.removeItem(PROPERTY_PROFILE_LS_KEY);
    } else {
      localStorage.setItem(PROPERTY_PROFILE_LS_KEY, JSON.stringify(profile));
    }
  } catch {
    // ignore storage errors
  }
}

async function fetchBotResponse(
  message: string,
  history: HistoryItem[],
  propertyProfile: PropertyProfile
): Promise<{ text: string; usedFallback: boolean }> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, propertyProfile }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { response: string; usedFallback: boolean };
    return { text: data.response, usedFallback: data.usedFallback ?? false };
  } catch {
    return {
      text: "Não consegui conectar ao servidor. Verifique sua conexão e tente novamente.",
      usedFallback: true,
    };
  }
}

/** Extract a property size hint like "500 hectares", "3000 ha" from text */
function extractPropertySize(text: string): string | null {
  const match = text.match(/(\d[\d.,]*)\s*(hectares?|ha)\b/i);
  if (match) return `${match[1]} ha`;
  return null;
}

type ChatStatus = "checking" | "online" | "offline";

async function fetchChatStatus(): Promise<ChatStatus> {
  try {
    const res = await fetch("/api/chat/status");
    if (!res.ok) return "offline";
    const data = await res.json() as { online: boolean };
    return data.online ? "online" : "offline";
  } catch {
    return "offline";
  }
}

/** Fetch the server-side property profile (returns null if not authenticated or no profile). */
async function fetchServerProfile(): Promise<PropertyProfile | null> {
  try {
    const res = await fetch("/api/chat/property-profile");
    if (res.status === 401) return null; // not authenticated
    if (!res.ok) return null;
    const data = await res.json() as PropertyProfile;
    return Object.keys(data).length > 0 ? data : null;
  } catch {
    return null;
  }
}

/** Persist the profile to the server (fire-and-forget; ignores auth errors). */
async function pushProfileToServer(profile: PropertyProfile): Promise<void> {
  try {
    await fetch("/api/chat/property-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
  } catch {
    // ignore network errors
  }
}

/** Delete the profile from the server. */
async function deleteServerProfile(): Promise<void> {
  try {
    await fetch("/api/chat/property-profile", { method: "DELETE" });
  } catch {
    // ignore network errors
  }
}

export function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [propertyProfile, setPropertyProfileState] = useState<PropertyProfile>(() => loadProfileFromStorage());
  const [chatStatus, setChatStatus] = useState<ChatStatus>("checking");
  const bottomRef = useRef<HTMLDivElement>(null);
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const profileLoaded = useRef(false);

  /** Update profile in state, localStorage, and server simultaneously. */
  const setPropertyProfile = useCallback((profile: PropertyProfile) => {
    setPropertyProfileState(profile);
    saveProfileToStorage(profile);
    pushProfileToServer(profile);
  }, []);

  /** Clear profile everywhere. */
  const clearPropertyProfile = useCallback(() => {
    setPropertyProfileState({});
    saveProfileToStorage({});
    deleteServerProfile();
  }, []);

  // On first mount: check server for a saved profile; if found, prefer it over localStorage.
  useEffect(() => {
    if (profileLoaded.current) return;
    profileLoaded.current = true;

    fetchServerProfile().then((serverProfile) => {
      if (serverProfile) {
        setPropertyProfileState(serverProfile);
        saveProfileToStorage(serverProfile);
      }
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    const status = await fetchChatStatus();
    setChatStatus(status);
  }, []);

  // Poll status while the chat window is open; clear when closed
  useEffect(() => {
    if (isOpen) {
      setChatStatus("checking");
      refreshStatus();
      statusIntervalRef.current = setInterval(refreshStatus, 30_000);
    } else {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    }
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    };
  }, [isOpen, refreshStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Build history array for context (last 8 exchanges)
  function buildHistory(): HistoryItem[] {
    return messages.slice(-16).map(m => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text,
    }));
  }

  /** Extract any property context from the user's message and merge into profile.
   *
   * Location update strategy:
   * - If no location is known yet, accept city-level OR state-level matches.
   * - If a location is already known, only overwrite it with a city-level match
   *   (high confidence) to prevent state-level heuristics from accidentally
   *   replacing a correct known location with a wrong guess.
   */
  function extractAndMergeProfile(text: string, currentProfile: PropertyProfile): PropertyProfile {
    const updates: Partial<PropertyProfile> = {};

    const alreadyHasLocation = Boolean(currentProfile.municipality);

    if (alreadyHasLocation) {
      // Only overwrite if a specific city name was found
      const cityCtx = getCityLevelLocationContext(text);
      if (cityCtx) {
        updates.municipality = cityCtx.municipality;
        updates.state = cityCtx.state;
        updates.biome = cityCtx.biome;
      }
    } else {
      // First detection: accept any confident location signal
      const locationCtx = getLocationContextFromText(text);
      if (locationCtx) {
        updates.municipality = locationCtx.municipality;
        updates.state = locationCtx.state;
        updates.biome = locationCtx.biome;
      }
    }

    const size = extractPropertySize(text);
    if (size) {
      updates.propertySize = size;
    }

    if (Object.keys(updates).length === 0) return currentProfile;

    const merged = { ...currentProfile, ...updates };
    setPropertyProfile(merged);
    return merged;
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      text: trimmed,
      sender: "user",
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const currentProfile = extractAndMergeProfile(trimmed, propertyProfile);
    const history = buildHistory();
    const { text: botText, usedFallback } = await fetchBotResponse(trimmed, history, currentProfile);

    const botMsg: Message = {
      id: (Date.now() + 1).toString(),
      text: botText,
      sender: "bot",
      timestamp: new Date(),
      usedFallback,
    };
    setMessages(prev => [...prev, botMsg]);
    setIsLoading(false);
  }

  const hasProfile = Boolean(
    propertyProfile.municipality || propertyProfile.state || propertyProfile.biome || propertyProfile.propertySize
  );

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="button-chatbot-toggle"
        className="fixed bottom-6 right-6 p-3.5 bg-gradient-to-br from-primary to-emerald-700 text-white rounded-full shadow-xl hover:shadow-2xl hover:scale-105 transition-all z-40"
        aria-label="Abrir assistente"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Bot className="w-6 h-6" />}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-[380px] h-[540px] bg-card rounded-2xl shadow-2xl flex flex-col z-40 border border-border/50 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary to-emerald-700 text-white p-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm leading-none text-white">Assistente de Risco</h3>
                <p className="text-emerald-200 text-xs mt-0.5">{PRODUCT_NAME} · TRL 4</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {/* AI status pill */}
              <div
                data-testid="chat-status-pill"
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all",
                  chatStatus === "online"
                    ? "bg-white/20 text-white"
                    : chatStatus === "offline"
                    ? "bg-red-500/30 text-red-100"
                    : "bg-white/10 text-white/60"
                )}
              >
                {chatStatus === "checking" ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : chatStatus === "online" ? (
                  <Wifi className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                {chatStatus === "checking"
                  ? "verificando"
                  : chatStatus === "online"
                  ? "online"
                  : "offline"}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                data-testid="button-chatbot-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Property context banner */}
          {hasProfile && (
            <div className="bg-primary/5 border-b border-primary/10 px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-primary/80 min-w-0">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {[propertyProfile.municipality, propertyProfile.state, propertyProfile.propertySize]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <button
                onClick={clearPropertyProfile}
                data-testid="button-clear-property-profile"
                title="Limpar contexto da propriedade"
                className="p-1 rounded hover:bg-red-100 hover:text-red-600 text-muted-foreground transition-colors shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background/50" id="chatbot-messages">
            {messages.length === 0 && (
              <div className="text-center mt-2">
                <div className="w-12 h-12 mx-auto bg-primary/10 rounded-2xl flex items-center justify-center mb-3">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <p className="font-bold text-foreground text-sm mb-1">
                  Olá! Sou o Assistente de Risco
                </p>
                <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                  Posso ajudar a interpretar o índice de risco, fatores ambientais,
                  protocolos de prevenção e como usar a plataforma.
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mb-4 text-left">
                  <p className="text-xs text-amber-800 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {SIMULATED_DATA_LABEL}
                  </p>
                </div>
                <div className="space-y-2">
                  {QUICK_QUESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      disabled={isLoading}
                      className="w-full text-left px-3 py-2.5 rounded-xl bg-card border border-border/50 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-all leading-relaxed disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div
                key={msg.id}
                className={cn("flex", msg.sender === "user" ? "justify-end" : "justify-start")}
              >
                {msg.sender === "bot" && (
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-1">
                    <Bot className="w-3.5 h-3.5 text-primary" />
                  </div>
                )}
                <div className="max-w-[78%] space-y-1">
                  <div
                    className={cn(
                      "px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed",
                      msg.sender === "user"
                        ? "bg-primary text-white rounded-br-sm"
                        : "bg-card border border-border/50 text-foreground rounded-bl-sm"
                    )}
                    data-testid={`message-${msg.sender}-${msg.id}`}
                  >
                    {msg.sender === "user" ? (
                      msg.text
                    ) : (
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }) => <em>{children}</em>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                          li: ({ children }) => <li>{children}</li>,
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-primary">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    )}
                  </div>
                  {msg.sender === "bot" && msg.usedFallback && (
                    <p className="text-xs text-amber-600/80 flex items-center gap-1 pl-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" /> Respondendo offline — usando base de conhecimento local
                    </p>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-1">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="bg-card border border-border/50 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border/50 p-3 flex gap-2 bg-card shrink-0">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
              placeholder="Pergunte sobre risco, prevenção..."
              data-testid="input-chatbot-message"
              disabled={isLoading}
              className="flex-1 px-3 py-2 border border-border/50 rounded-xl text-sm focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none transition-all bg-background disabled:opacity-50"
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              size="icon"
              className="bg-primary hover:bg-primary/90 rounded-xl shrink-0 disabled:opacity-60"
              data-testid="button-chatbot-send"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
