import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "../api";
import MarkdownMessage from "./MarkdownMessage";

/** Strip tool_call markup so protocol never appears in the UI. */
function stripToolCallMarkup(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "[Used a tool]")
    .replace(/tool_call>[\s\S]*?<\/tool_call>/gi, "[Used a tool]")
    .trim();
}

/** Remove markdown image syntax ![alt](url) so images are not duplicated when shown in the carousel. */
function stripMarkdownImages(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function AssistantIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a1 1 0 0 1 .993.883L13 3v3.586l2.121-2.121a1 1 0 0 1 1.497 1.32l-.083.094-2.121 2.121H18a1 1 0 0 1 .117 1.993L18 10h-3.586l2.121 2.121a1 1 0 0 1-1.32 1.497l-.094-.083L13 11.414V15a1 1 0 0 1-1.993.117L11 15v-3.586l-2.121 2.121a1 1 0 0 1-1.497-1.32l.083-.094L9.586 10H6a1 1 0 0 1-.117-1.993L6 8h3.586L7.465 5.879a1 1 0 0 1 1.32-1.497l.094.083L11 6.586V3a1 1 0 0 1 1-1Z"/>
      <path d="M19 16a1 1 0 0 1 .993.883L20 17v1h1a1 1 0 0 1 .117 1.993L21 20h-1v1a1 1 0 0 1-1.993.117L18 21v-1h-1a1 1 0 0 1-.117-1.993L17 18h1v-1a1 1 0 0 1 1-1ZM5 16a1 1 0 0 1 .993.883L6 17v1h1a1 1 0 0 1 .117 1.993L7 20H6v1a1 1 0 0 1-1.993.117L4 21v-1H3a1 1 0 0 1-.117-1.993L3 18h1v-1a1 1 0 0 1 1-1Z"/>
    </svg>
  );
}

function ChatArea({
  currentConversation,
  selectedModel,
  onModelChange,
  onSendSuccess,
  onNewConversationCreated,
  onConversationListChange,
}) {
  const [models, setModels] = useState([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [optimisticUserMessage, setOptimisticUserMessage] = useState(null);
  const [streamingContent, setStreamingContent] = useState("");
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [toolEvents, setToolEvents] = useState([]);
  const [sendError, setSendError] = useState(null);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);
  const messagesEndRef = useRef(null);

  const baseMessages = (currentConversation?.messages ?? []).map((m) => ({
    role: m.role,
    text: m.content ?? m.text ?? "",
    typing: false,
  }));
  const displayMessages = [
    ...baseMessages,
    ...(optimisticUserMessage ? [{ role: "user", text: optimisticUserMessage, typing: false }] : []),
    ...(sending
      ? streamingContent
        ? [{ role: "assistant", text: streamingContent, typing: false }]
        : [{ role: "assistant", text: "", typing: true }]
      : []),
  ];
  const effectiveModel = currentConversation?.model ?? selectedModel;
  const isEmpty = !currentConversation && baseMessages.length === 0 && !optimisticUserMessage;
  const hasInput = inputValue.trim().length > 0;

  const currentModelLabel = models.find((m) => m.id === effectiveModel || m.name === effectiveModel)?.name ?? effectiveModel ?? "Select model";

  useEffect(() => {
    api.getModels().then((list) => {
      const arr = Array.isArray(list) ? list : [];
      const mapped = arr.map((m) => ({ id: m.name || m.id, name: m.name || m.id }));
      setModels(mapped);
      if (mapped.length > 0 && (!selectedModel || !mapped.some((m) => m.id === selectedModel || m.name === selectedModel))) {
        onModelChange(mapped[0].id);
      }
    }).catch(() => setModels([]));
  }, [selectedModel, onModelChange]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [inputValue]);

  useEffect(() => {
    function handle(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, streamingContent, sendError]);

  const handleSend = useCallback(async () => {
    if (!hasInput || sending) return;
    const content = inputValue.trim();
    setInputValue("");
    setOptimisticUserMessage(content);
    setSending(true);
    setStreamingContent("");
    setToolEvents([]);
    setSendError(null);

    const clearSendingState = () => {
      setSending(false);
      setOptimisticUserMessage(null);
      setStreamingContent("");
      // Do not clear toolEvents here so the last reply keeps showing Tools used, carousel, and Sources
    };

    const persistStreamedReply = async (convId, replyContent, isNew) => {
      try {
        const assistantContent = (replyContent ?? "").trim() || "(No response)";
        await api.addMessage(convId, "assistant", assistantContent);
        if (isNew) {
          const titleData = await api.generateTitle(content, assistantContent, effectiveModel);
          const title = (titleData.title || "New conversation").slice(0, 100);
          await api.updateConversation(convId, { title });
          const updated = await api.getConversation(convId);
          onNewConversationCreated(updated);
        } else {
          onSendSuccess();
        }
        onConversationListChange();
      } catch (e) {
        setSendError(e?.message || "Something went wrong. Please try again.");
        clearSendingState();
      }
    };

    try {
      if (toolsEnabled) {
        const chatMessages = currentConversation
          ? (currentConversation.messages || []).map((m) => ({ role: m.role, content: m.content || m.text })).concat([{ role: "user", content }])
          : [{ role: "user", content }];
        if (!currentConversation) {
          const conv = await api.createConversation(effectiveModel);
          await api.addMessage(conv.id, "user", content);
          api.chatStreamWithTools(
            effectiveModel,
            chatMessages,
            {
              onChunk: (chunk) => setStreamingContent((prev) => prev + chunk),
              onToolCall: (data) => setToolEvents((prev) => [...prev, { type: "tool_call", data }]),
              onToolResult: (data) => setToolEvents((prev) => [...prev, { type: "tool_result", data }]),
              onDone: async (data) => {
                const text = data?.fullContent ?? (typeof data === "string" ? data : null);
                if (data?.error) {
                  setSendError(data.error || "Something went wrong. Please try again.");
                  clearSendingState();
                  return;
                }
                if (text != null) await persistStreamedReply(conv.id, text, true);
                clearSendingState();
                onConversationListChange?.();
              },
            }
          );
        } else {
          await api.addMessage(currentConversation.id, "user", content);
          api.chatStreamWithTools(
            effectiveModel,
            chatMessages,
            {
              onChunk: (chunk) => setStreamingContent((prev) => prev + chunk),
              onToolCall: (data) => setToolEvents((prev) => [...prev, { type: "tool_call", data }]),
              onToolResult: (data) => setToolEvents((prev) => [...prev, { type: "tool_result", data }]),
              onDone: async (data) => {
                const text = data?.fullContent ?? (typeof data === "string" ? data : null);
                if (data?.error) {
                  setSendError(data.error || "Something went wrong. Please try again.");
                  clearSendingState();
                  return;
                }
                if (text != null) await persistStreamedReply(currentConversation.id, text, false);
                clearSendingState();
                onSendSuccess?.();
                onConversationListChange?.();
              },
            }
          );
        }
        return;
      }

      if (!currentConversation) {
        const conv = await api.createConversation(effectiveModel);
        await api.addMessage(conv.id, "user", content);
        const chatMessages = [{ role: "user", content }];
        api.chatStream(
          effectiveModel,
          chatMessages,
          (chunk) => setStreamingContent((prev) => prev + chunk),
          async (fullContent) => {
            if (fullContent != null) {
              await persistStreamedReply(conv.id, fullContent, true);
            } else {
              setSendError("Something went wrong. Please try again.");
            }
            clearSendingState();
          }
        );
      } else {
        await api.addMessage(currentConversation.id, "user", content);
        const history = (currentConversation.messages || []).map((m) => ({
          role: m.role,
          content: m.content || m.text,
        }));
        history.push({ role: "user", content });
        api.chatStream(
          effectiveModel,
          history,
          (chunk) => setStreamingContent((prev) => prev + chunk),
          async (fullContent) => {
            if (fullContent != null) {
              await persistStreamedReply(currentConversation.id, fullContent, false);
            } else {
              setSendError("Something went wrong. Please try again.");
            }
            clearSendingState();
          }
        );
      }
    } catch (e) {
      console.error(e);
      setSendError(e?.message || "Something went wrong. Please try again.");
      setInputValue(content);
      setOptimisticUserMessage(null);
      setStreamingContent("");
      setSending(false);
    }
  }, [
    hasInput,
    sending,
    inputValue,
    currentConversation,
    effectiveModel,
    onSendSuccess,
    onNewConversationCreated,
    onConversationListChange,
  ]);

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleModelSelect(id) {
    onModelChange(id);
    if (currentConversation?.id) {
      api.updateConversation(currentConversation.id, { model: id }).then(() => onSendSuccess?.()).catch(() => {});
    }
    setModelOpen(false);
  }

  return (
    <main className="chat-area" role="main">
      <div className="chat-area__topbar">
        <div className="chat-area__model-picker" ref={dropdownRef}>
          <button
            className="chat-area__model-btn"
            onClick={() => setModelOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={modelOpen}
          >
            <span>{currentModelLabel}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {modelOpen && (
            <div className="chat-area__model-dropdown" role="listbox" aria-label="Select model">
              {models.length === 0 ? (
                <div className="chat-area__model-option chat-area__model-option--empty">No models available</div>
              ) : (
                models.map((m) => (
                  <button
                    key={m.id}
                    className={`chat-area__model-option${(m.id === effectiveModel || m.name === effectiveModel) ? " chat-area__model-option--active" : ""}`}
                    role="option"
                    aria-selected={m.id === effectiveModel || m.name === effectiveModel}
                    onClick={() => handleModelSelect(m.id || m.name)}
                    type="button"
                  >
                    <div className="chat-area__model-option-info">
                      <span className="chat-area__model-option-label">{m.name}</span>
                    </div>
                    {(m.id === effectiveModel || m.name === effectiveModel) && (
                      <svg className="chat-area__model-option-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {isEmpty ? (
        <div className="chat-area__empty">
          <p className="chat-area__empty-prompt">Where should we begin?</p>
          <div className="chat-area__input-area chat-area__input-area--centered">
            <div className="chat-area__input-box">
              <textarea
                ref={textareaRef}
                className="chat-area__textarea"
                placeholder="Ask anything"
                value={inputValue}
                rows={1}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="Message input"
              />
              <div className="chat-area__input-row">
                <div className="chat-area__input-tools">
                  <label className="chat-area__tools-toggle">
                    <input
                      type="checkbox"
                      checked={toolsEnabled}
                      onChange={(e) => setToolsEnabled(e.target.checked)}
                      aria-label="Enable tools"
                    />
                    <span className="chat-area__tools-toggle-label">Tools</span>
                  </label>
                  <button className="chat-area__tool-btn" type="button" aria-label="Attach file">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>
                <button
                  className={`chat-area__send-btn${hasInput ? " chat-area__send-btn--active" : ""}`}
                  type="button"
                  aria-label="Send message"
                  disabled={!hasInput || sending}
                  onClick={handleSend}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="chat-area__messages" aria-live="polite">
            {displayMessages.map((msg, i) => (
              <div key={i} className={`message message--${msg.role}`}>
                {msg.role === "user" ? (
                  <div className="message__user-bubble">{msg.text}</div>
                ) : msg.typing ? (
                  <>
                    <div className="message__avatar-wrap" aria-hidden="true">
                      <AssistantIcon />
                    </div>
                    <div className="message__body">
                      <div className="message__typing" aria-live="polite" aria-busy="true">
                        <span className="message__typing-dot" />
                        <span className="message__typing-dot" />
                        <span className="message__typing-dot" />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="message__avatar-wrap" aria-hidden="true">
                      <AssistantIcon />
                    </div>
                    <div className="message__body">
                      {(() => {
                        const isLastMessage = i === displayMessages.length - 1;
                        const carouselImages = isLastMessage
                          ? toolEvents
                              .filter(
                                (e) =>
                                  e.type === "tool_result" &&
                                  e.data?.name === "image_query" &&
                                  e.data?.ok === true
                              )
                              .flatMap((e) => (Array.isArray(e.data?.result?.images) ? e.data.result.images : []))
                              .filter((img) => img && typeof img.url === "string" && img.url.trim() !== "")
                              .map((img) => ({ url: img.url.trim(), description: img.description ?? "" }))
                          : [];
                        const messageContent =
                          carouselImages.length > 0
                            ? stripMarkdownImages(stripToolCallMarkup(msg.text))
                            : stripToolCallMarkup(msg.text);
                        return (
                          <>
                            {isLastMessage && toolEvents.length > 0 && (
                              <div className="message__tools-used" aria-label="Tools used">
                                <span className="message__tools-label">Tools used:</span>
                                <ul className="message__tools-list">
                                  {toolEvents
                                    .filter((e) => e.type === "tool_result")
                                    .map((e, i) => (
                                      <li key={i} className="message__tools-item">
                                        <span className="message__tools-name">{e.data?.name}</span>
                                        {e.data?.ok === false ? (
                                          <span className="message__tools-error"> error</span>
                                        ) : (
                                          <span className="message__tools-ok"> ok</span>
                                        )}
                                      </li>
                                    ))}
                                </ul>
                              </div>
                            )}
                            {carouselImages.length > 0 && (
                              <div className="message__image-carousel" aria-label="Image results">
                                <div className="message__image-carousel-inner">
                                  {carouselImages.map((img, idx) => (
                                    <a
                                      key={`${idx}-${img.url.slice(0, 40)}`}
                                      href={img.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="message__image-carousel-item"
                                    >
                                      <img src={img.url} alt={img.description || "Image"} loading="lazy" />
                                      {img.description ? (
                                        <span className="message__image-carousel-caption">{img.description}</span>
                                      ) : null}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                            <MarkdownMessage content={messageContent} />
                          </>
                        );
                      })()}
                      {(() => {
                        const isLastForSources = i === displayMessages.length - 1;
                        const webResults = isLastForSources
                          ? toolEvents
                              .filter((e) => e.type === "tool_result" && e.data?.name === "web" && e.data?.ok === true)
                              .flatMap((e) => (Array.isArray(e.data?.result?.results) ? e.data.result.results : []))
                              .filter((r) => r && typeof r.url === "string" && r.url.trim() !== "")
                          : [];
                        const seen = new Set();
                        const sources = webResults.filter((r) => {
                          const u = r.url.trim();
                          if (seen.has(u)) return false;
                          seen.add(u);
                          return true;
                        });
                        if (sources.length === 0) return null;
                        const faviconUrl = (url) => {
                          try {
                            const domain = new URL(url).hostname;
                            return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
                          } catch {
                            return "";
                          }
                        };
                        return (
                          <div className="message__sources" aria-label="Sources">
                            <div className="message__sources-icons">
                              {sources.map((s, idx) => (
                                <a
                                  key={`${idx}-${s.url}`}
                                  href={s.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="message__sources-icon"
                                  title={s.title || s.url}
                                >
                                  {s.favicon ? (
                                    <img src={s.favicon} alt="" className="message__sources-favicon" />
                                  ) : (
                                    <img src={faviconUrl(s.url)} alt="" className="message__sources-favicon" />
                                  )}
                                </a>
                              ))}
                            </div>
                            <span className="message__sources-label">Sources</span>
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>
            ))}
            {sendError && (
              <div className="message message--assistant message--error">
                <div className="message__avatar-wrap" aria-hidden="true">
                  <AssistantIcon />
                </div>
                <div className="message__body">
                  <div className="message__error-bubble">
                    <p className="message__error-text">{sendError}</p>
                    <button
                      type="button"
                      className="message__error-retry"
                      onClick={() => setSendError(null)}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-area__input-area">
            <div className="chat-area__input-box">
              <textarea
                ref={textareaRef}
                className="chat-area__textarea"
                placeholder="Message LocalGPT"
                value={inputValue}
                rows={1}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="Message input"
              />
              <div className="chat-area__input-row">
                <div className="chat-area__input-tools">
                  <label className="chat-area__tools-toggle">
                    <input
                      type="checkbox"
                      checked={toolsEnabled}
                      onChange={(e) => setToolsEnabled(e.target.checked)}
                      aria-label="Enable tools"
                    />
                    <span className="chat-area__tools-toggle-label">Tools</span>
                  </label>
                  <button className="chat-area__tool-btn" type="button" aria-label="Attach file">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                </div>
                <button
                  className={`chat-area__send-btn${hasInput ? " chat-area__send-btn--active" : ""}`}
                  type="button"
                  aria-label="Send message"
                  disabled={!hasInput || sending}
                  onClick={handleSend}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
            </div>
            <p className="chat-area__disclaimer">
              LocalGPT can make mistakes. Consider checking important information.
            </p>
          </div>
        </>
      )}
    </main>
  );
}

export default ChatArea;
