"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type ChatConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ApiError = { error?: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function Chatbot() {
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);

  const refreshHistory = useCallback(async () => {
    const result = await requestJson<{ conversations: ChatConversation[] }>("/api/chatbot/conversations");
    setConversations(result.conversations);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      setLoadingHistory(true);
      void refreshHistory()
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load chat history."))
        .finally(() => setLoadingHistory(false));
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [refreshHistory]);

  useEffect(() => {
    if (view !== "chat") return;
    requestAnimationFrame(() => {
      if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight;
    });
  }, [messages, view]);

  async function openConversation(item: ChatConversation) {
    setError(null);
    setLoadingConversation(true);
    try {
      const result = await requestJson<{ conversation: ChatConversation; messages: ChatMessage[] }>(
        `/api/chatbot/conversations?conversationId=${encodeURIComponent(item.id)}`,
      );
      setConversationId(result.conversation.id);
      setMessages(result.messages);
      setView("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([]);
    setQuestion("");
    setError(null);
    setView("chat");
    questionInput.current?.focus();
  }

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = question.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await requestJson<{ conversationId: string; messages: ChatMessage[] }>("/api/chatbot/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, conversationId }),
      });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, ...result.messages]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get an answer.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-2xl">🤖</div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">ChatCloud Assistant</h1>
            <p className="mt-1 text-sm text-slate-600">Ask about your files, renewals, and how to use ChatCloud.</p>
          </div>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">Your private vault context</span>
      </header>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex gap-1" role="tablist" aria-label="Chatbot views">
            <button
              type="button"
              role="tab"
              aria-selected={view === "chat"}
              onClick={() => setView("chat")}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${view === "chat" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "history"}
              onClick={() => {
                setError(null);
                setView("history");
                setLoadingHistory(true);
                void refreshHistory()
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load chat history."))
                  .finally(() => setLoadingHistory(false));
              }}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${view === "history" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
            >
              History
            </button>
          </div>
          <button
            type="button"
            onClick={startNewChat}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + New chat
          </button>
        </div>

        {error && (
          <div role="alert" className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {view === "chat" ? (
          <div className="flex h-[min(68vh,680px)] min-h-[420px] flex-col">
            <div ref={messageList} className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4 sm:p-6">
              {messages.length === 0 ? (
                <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center text-center">
                  <span className="text-4xl">☁️</span>
                  <h2 className="mt-3 font-semibold text-slate-800">Ask about your ChatCloud</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Try “Which renewals are coming up?”, “How do I find files sent to myself?”, or “What files do I have in Other?”
                  </p>
                </div>
              ) : messages.map((message) => (
                <article key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[78%] ${
                    message.role === "user"
                      ? "rounded-br-sm bg-indigo-600 text-white"
                      : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                  }`}>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
                    <p className={`mt-1 text-right text-[10px] ${message.role === "user" ? "text-indigo-100" : "text-slate-400"}`}>
                      {formatDate(message.created_at)}
                    </p>
                  </div>
                </article>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <p role="status" className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                    Checking your ChatCloud and thinking...
                  </p>
                </div>
              )}
            </div>
            <form onSubmit={(event) => void sendQuestion(event)} className="border-t border-slate-200 p-3 sm:p-4">
              <div className="flex items-end gap-2">
                <textarea
                  ref={questionInput}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  maxLength={2000}
                  rows={2}
                  placeholder="Ask about ChatCloud or your files..."
                  aria-label="Your question"
                  className="min-h-11 min-w-0 flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="submit"
                  disabled={sending || !question.trim()}
                  className="h-11 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "Thinking..." : "Send"}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Answers use file and renewal metadata, not document contents. Press Enter to send; Shift+Enter for a new line.
              </p>
            </form>
          </div>
        ) : (
          <section className="min-h-[420px] p-4 sm:p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Previous chats</h2>
              <p className="mt-1 text-sm text-slate-500">Your questions and answers are only visible to your account.</p>
            </div>
            {loadingHistory ? (
              <p className="py-10 text-center text-sm text-slate-500">Loading history...</p>
            ) : conversations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center">
                <p className="font-medium text-slate-700">No previous chats</p>
                <p className="mt-1 text-sm text-slate-500">Ask a question to start your first conversation.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {conversations.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={loadingConversation}
                      onClick={() => void openConversation(item)}
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{item.title}</span>
                        <span className="mt-1 block text-xs text-slate-500">Updated {formatDate(item.updated_at)}</span>
                      </span>
                      <span className="shrink-0 text-sm text-indigo-600">{loadingConversation ? "Opening..." : "Open →"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
