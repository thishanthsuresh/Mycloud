"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { decryptFile } from "@/lib/security/file-crypto";
import BillsChat from "./BillsChat";

const BILLS_CHAT_ID = "private-bills-chat";

type MessengerUser = {
  user_id: string;
  email: string;
  display_name: string;
};

type Conversation = {
  id: string;
  user_one: string;
  user_two: string;
  created_at: string;
  updated_at: string;
  otherUser: MessengerUser | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  media_path: string | null;
  media_name: string | null;
  media_type: string | null;
  media_size: number | null;
  is_encrypted: boolean;
  encryption_salt: string | null;
  encryption_iv: string | null;
  pin_digits: number;
  original_mime_type: string | null;
  mediaUrl: string | null;
  created_at: string;
};

type ApiError = { error?: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatSize(value: number | null) {
  if (value === null) return "";
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Messenger() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [userId, setUserId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [messageState, setMessageState] = useState<{ conversationId: string; messages: Message[] } | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [sending, setSending] = useState(false);
  const [forwardingMessageId, setForwardingMessageId] = useState<string | null>(null);
  const [savingChatcloudMessageId, setSavingChatcloudMessageId] = useState<string | null>(null);
  const [unlockingMessageId, setUnlockingMessageId] = useState<string | null>(null);
  const [decryptPin, setDecryptPin] = useState("");
  const [searching, setSearching] = useState(false);
  const [email, setEmail] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messagePane = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const result = await requestJson<{ userId: string; conversations: Conversation[] }>("/api/messenger/conversations");
      setUserId(result.userId);
      setConversations(result.conversations);
      setSelectedId((current) => current || result.conversations[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load conversations.");
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refreshConversations(), 0);
    const interval = window.setInterval(() => void refreshConversations(), 8000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [refreshConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const result = await requestJson<{ messages: Message[] }>(
        `/api/messenger/messages?conversationId=${encodeURIComponent(conversationId)}`,
      );
      const pane = messagePane.current;
      const nearBottom = !pane || pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120;
      setMessageState({ conversationId, messages: result.messages });
      if (nearBottom) requestAnimationFrame(() => {
        if (messagePane.current) messagePane.current.scrollTop = messagePane.current.scrollHeight;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load messages.");
    }
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId === BILLS_CHAT_ID) return;
    const initialLoad = window.setTimeout(() => void loadMessages(selectedId), 0);
    const interval = window.setInterval(() => void loadMessages(selectedId), 4000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [selectedId, loadMessages]);

  const messages = messageState?.conversationId === selectedId ? messageState.messages : [];

  async function startConversation(recipientId: string) {
    setSearching(true);
    setError(null);
    try {
      const result = await requestJson<{ conversationId: string }>("/api/messenger/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId }),
      });
      await refreshConversations();
      setSelectedId(result.conversationId);
      setEmail("");
      setNotice(recipientId === userId ? "Your private saved chat is ready." : "Conversation opened.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start that conversation.");
    } finally {
      setSearching(false);
    }
  }

  async function findUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ user: MessengerUser }>(
        `/api/messenger/users?email=${encodeURIComponent(email)}`,
      );
      await startConversation(result.user.user_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not find that user.");
      setSearching(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("conversationId", selectedId);
      form.set("body", messageBody);
      if (selectedMedia) form.set("media", selectedMedia);
      await requestJson<{ message: Message }>("/api/messenger/messages", {
        method: "POST",
        body: form,
      });
      setMessageBody("");
      setSelectedMedia(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadMessages(selectedId);
      await refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setSending(false);
    }
  }

  async function forwardToSelf(message: Message) {
    if (forwardingMessageId || !message.media_path) return;
    setForwardingMessageId(message.id);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ conversationId: string }>("/api/messenger/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      await refreshConversations();
      setSelectedId(result.conversationId);
      await loadMessages(result.conversationId);
      setNotice("Media saved to your self-chat and ChatCloud.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the media to yourself.");
    } finally {
      setForwardingMessageId(null);
    }

  }

  async function saveToChatCloud(message: Message) {
    if (savingChatcloudMessageId || !message.media_path) return;
    setSavingChatcloudMessageId(message.id);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<{ status: "saved" | "already-saved" }>("/api/messenger/save-to-chatcloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id }),
      });
      setNotice(result.status === "already-saved" ? "This attachment is already in ChatCloud." : "Attachment saved to ChatCloud.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the attachment to ChatCloud.");
    } finally {
      setSavingChatcloudMessageId(null);
    }
  }

  async function unlockAttachment(message: Message) {
    if (!message.mediaUrl || !message.encryption_salt || !message.encryption_iv) {
      setError("This encrypted attachment is missing its unlock information.");
      return;
    }
    if (!new RegExp(`^\\d{${message.pin_digits}}$`).test(decryptPin)) {
      setError(`Enter the ${message.pin_digits}-digit PIN from the sender.`);
      return;
    }
    setError(null);
    setSending(true);
    try {
      const response = await fetch(message.mediaUrl);
      if (!response.ok) throw new Error("Could not download the encrypted attachment.");
      const decrypted = await decryptFile(
        await response.arrayBuffer(),
        decryptPin,
        message.encryption_salt,
        message.encryption_iv,
        message.pin_digits,
      );
      const url = URL.createObjectURL(new Blob([decrypted], { type: message.original_mime_type ?? "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = message.media_name ?? "decrypted-file";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDecryptPin("");
      setUnlockingMessageId(null);
      setNotice("Attachment decrypted in this browser and downloaded.");
    } catch (err) {
      setError(err instanceof Error && err.name === "OperationError"
        ? "That PIN did not unlock this attachment."
        : err instanceof Error ? err.message : "Could not decrypt the attachment.");
    } finally {
      setSending(false);
    }
  }

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId);
  const isSelfChat = selectedConversation?.otherUser?.user_id === userId;
  const regularConversations = conversations.filter((conversation) => conversation.otherUser?.user_id !== userId);
  const conversationTitle = isSelfChat
    ? "You"
    : selectedConversation?.otherUser?.display_name ?? selectedConversation?.otherUser?.email ?? "Conversation";

  return (
    <div className="grid h-[min(78vh,820px)] min-h-[560px] grid-rows-[minmax(220px,0.8fr)_minmax(0,1.7fr)] overflow-hidden rounded-lg border border-slate-200 bg-white md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-900">Chats</h2>
          <p className="mt-1 text-xs text-slate-500">Private chats with MyCloud users</p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setSelectedId(BILLS_CHAT_ID);
            }}
            aria-pressed={selectedId === BILLS_CHAT_ID}
            className={`mt-3 block w-full rounded-lg border border-emerald-200 px-3 py-2 text-left text-sm font-medium text-emerald-800 hover:bg-emerald-100 ${
              selectedId === BILLS_CHAT_ID ? "bg-emerald-100" : "bg-emerald-50"
            }`}
          >
            🧾 &nbsp; Bills
            <span className="mt-0.5 block pl-6 text-xs font-normal text-emerald-700">Send bills and track expenses</span>
          </button>
          <button
            type="button"
            onClick={() => void startConversation(userId)}
            disabled={!userId || searching}
            aria-pressed={isSelfChat}
            className={`mt-2 block w-full rounded-lg border border-indigo-200 px-3 py-2 text-left text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:cursor-wait disabled:opacity-60 ${
              isSelfChat ? "bg-indigo-100" : "bg-indigo-50"
            }`}
          >
            ☁️ &nbsp; You
            <span className="mt-0.5 block pl-6 text-xs font-normal text-indigo-700">Your private saved chat</span>
          </button>
          <form onSubmit={findUser} className="mt-3 space-y-2">
            <label htmlFor="messenger-email" className="block text-xs font-medium text-slate-600">
              Start a chat by email
            </label>
            <div className="flex gap-2">
              <input
                id="messenger-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="submit"
                disabled={searching}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {searching ? "..." : "Go"}
              </button>
            </div>
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingConversations ? (
            <p className="p-4 text-sm text-slate-500">Loading chats...</p>
          ) : regularConversations.length === 0 ? (
            <p className="p-4 text-sm leading-6 text-slate-500">No conversations yet. Start a chat by email or open your private saved chat.</p>
          ) : regularConversations.map((conversation) => {
            const label = conversation.otherUser?.display_name ?? conversation.otherUser?.email ?? "MyCloud user";
            const subtitle = conversation.otherUser?.email ?? "";
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setSelectedId(conversation.id);
                }}
                className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedId === conversation.id ? "bg-indigo-50" : ""
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg">
                  👤
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
                  <span className="block truncate text-xs text-slate-500">{subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col">
        {selectedId === BILLS_CHAT_ID ? (
          <BillsChat />
        ) : selectedConversation ? (
          <>
            <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100">
                {isSelfChat ? "☁️" : "👤"}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-900">{conversationTitle}</h3>
                <p className="truncate text-xs text-slate-500">
                  {isSelfChat ? "Messages and media saved just for you" : selectedConversation.otherUser?.email}
                </p>
              </div>
            </header>
            <div ref={messagePane} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  {isSelfChat ? "Send a message or media here to keep it in your private chat." : "Say hello to start the conversation."}
                </p>
              ) : messages.map((message) => {
                const own = message.sender_id === userId;
                return (
                  <article key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${
                      own ? "rounded-br-sm bg-indigo-600 text-white" : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                    }`}>
                      {message.body && <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>}
                      {message.is_encrypted && message.mediaUrl && (
                        <div className={`mt-2 rounded-lg p-3 ${own ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-800"}`}>
                          <p className="text-sm font-medium">🔒 PIN-protected attachment</p>
                          <p className="mt-1 break-all text-xs">{message.media_name ?? "Encrypted file"} · {formatSize(message.media_size)}</p>
                          {unlockingMessageId === message.id ? (
                            <form onSubmit={(event) => { event.preventDefault(); void unlockAttachment(message); }} className="mt-2 flex flex-wrap gap-2">
                              <input
                                type="password"
                                inputMode="numeric"
                                pattern={`[0-9]{${message.pin_digits}}`}
                                maxLength={message.pin_digits}
                                minLength={message.pin_digits}
                                required
                                autoComplete="off"
                                aria-label={`Sender's ${message.pin_digits}-digit decryption PIN`}
                                placeholder={`${message.pin_digits}-digit PIN`}
                                value={decryptPin}
                                onChange={(event) => setDecryptPin(event.target.value.replace(/\D/g, "").slice(0, message.pin_digits))}
                                className="w-28 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                              />
                              <button type="submit" disabled={sending || decryptPin.length !== message.pin_digits} className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                                {sending ? "Decrypting…" : "Decrypt"}
                              </button>
                              <button type="button" onClick={() => { setUnlockingMessageId(null); setDecryptPin(""); }} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700">
                                Cancel
                              </button>
                            </form>
                          ) : (
                            <button type="button" onClick={() => { setError(null); setDecryptPin(""); setUnlockingMessageId(message.id); }} className="mt-2 rounded border border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                              Enter PIN to decrypt
                            </button>
                          )}
                        </div>
                      )}
                      {!message.is_encrypted && message.mediaUrl && message.media_type?.startsWith("image/") && (
                        <a href={message.mediaUrl} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={message.mediaUrl} alt={message.media_name ?? "Shared image"} className="mt-1 max-h-72 max-w-full rounded-lg object-contain" />
                        </a>
                      )}
                      {!message.is_encrypted && message.mediaUrl && message.media_type?.startsWith("video/") && (
                        <video src={message.mediaUrl} controls className="mt-1 max-h-72 max-w-full rounded-lg" />
                      )}
                      {!message.is_encrypted && message.mediaUrl && message.media_type?.startsWith("audio/") && (
                        <audio src={message.mediaUrl} controls className="mt-1 max-w-full" />
                      )}
                      {!message.is_encrypted && message.mediaUrl && message.media_type === "application/pdf" && (
                        <a href={message.mediaUrl} target="_blank" rel="noreferrer" className={`mt-1 flex items-center gap-2 rounded-lg p-2 text-sm underline ${
                          own ? "bg-indigo-700 text-white" : "bg-slate-100 text-indigo-700"
                        }`}>
                          📄 <span className="max-w-52 truncate">{message.media_name ?? "Open PDF"}</span>
                          <span className="text-xs no-underline">{formatSize(message.media_size)}</span>
                        </a>
                      )}
                      {!message.is_encrypted && !own && !isSelfChat && message.media_path && (
                        <button
                          type="button"
                          onClick={() => void forwardToSelf(message)}
                          disabled={forwardingMessageId !== null}
                          className="mt-2 block rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"
                        >
                          {forwardingMessageId === message.id ? "Saving..." : "Forward to You"}
                        </button>
                      )}
                      {!message.is_encrypted && !isSelfChat && message.media_path && (
                        <button
                          type="button"
                          onClick={() => void saveToChatCloud(message)}
                          disabled={savingChatcloudMessageId !== null}
                          className="mt-2 block rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60"
                        >
                          {savingChatcloudMessageId === message.id ? "Saving..." : "Save to ChatCloud"}
                        </button>
                      )}
                      <p className={`mt-1 text-right text-[10px] ${own ? "text-indigo-100" : "text-slate-400"}`}>
                        {formatTime(message.created_at)}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
            <form onSubmit={sendMessage} className="border-t border-slate-200 p-3">
              {selectedMedia && (
                <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                  <span className="truncate">{selectedMedia.name} · {formatSize(selectedMedia.size)}</span>
                  <button type="button" onClick={() => {
                    setSelectedMedia(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }} className="ml-3 font-medium text-slate-700 hover:text-red-600">
                    Remove
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  maxLength={4000}
                  rows={2}
                  placeholder={isSelfChat ? "Write a note to yourself..." : "Write a message..."}
                  className="min-h-11 min-w-0 flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf"
                  className="hidden"
                  onChange={(event) => setSelectedMedia(event.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  aria-label="Attach media"
                  title="Attach image, video, audio, or PDF (up to 10 MB)"
                  className="h-10 w-10 shrink-0 rounded-lg border border-slate-300 text-lg hover:bg-slate-50"
                >
                  +
                </button>
                <button
                  type="submit"
                  disabled={sending || (!messageBody.trim() && !selectedMedia)}
                  className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? "..." : "Send"}
                </button>
              </div>
              <p className="mt-1 text-right text-[10px] text-slate-400">Media up to 10 MB · 4,000 characters max</p>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <span className="text-4xl">💬</span>
            <p className="mt-3 font-medium text-slate-800">Choose a chat to get started</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">Search by email to message another MyCloud user, or open your personal chat to save messages and media.</p>
          </div>
        )}
      </section>

      {(error || notice) && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg">
          {error ? (
            <p role="alert" className="text-red-700">{error}</p>
          ) : (
            <p role="status" className="text-emerald-700">{notice}</p>
          )}
          <button type="button" onClick={() => { setError(null); setNotice(null); }} className="mt-1 text-xs text-slate-500 underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
