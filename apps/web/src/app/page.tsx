'use client';

import { useState, useRef, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import type { StreamEvent } from '@scaffold/shared';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

interface ImageFile {
  id: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  base64: string;
  preview: string;
}

// When using oauth2-proxy (port 4180), use same origin for API calls
// When running without auth, can set NEXT_PUBLIC_API_URL=http://localhost:3001
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [currentTool, setCurrentTool] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      if (!file.type.match(/^image\/(png|jpeg|webp|gif)$/)) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const base64 = result.split(',')[1];
        if (!base64) return;

        const mimeType = file.type as ImageFile['mimeType'];
        setImages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            mimeType,
            base64,
            preview: result,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() && images.length === 0) return;
    if (isLoading) return;

    // Capture values before any state updates
    const messageText = input;
    const currentConversationId = conversationId;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
    };

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setCurrentTool(null);

    const imagesToSend = images.map((img) => ({
      mimeType: img.mimeType,
      base64: img.base64,
    }));
    setImages([]);

    try {
      // IMPORTANT: Don't send null values - Zod .optional() only accepts undefined, not null
      const requestBody: { message: string; conversationId?: string; images?: typeof imagesToSend } = {
        message: messageText,
      };
      if (currentConversationId) {
        requestBody.conversationId = currentConversationId;
      }
      if (imagesToSend.length > 0) {
        requestBody.images = imagesToSend;
      }

      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send message: ${response.status} ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (done) break;

        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line) as StreamEvent;

            switch (event.type) {
              case 'meta':
                setConversationId(event.conversationId);
                if (event.traceId) {
                  setTraceId(event.traceId);
                }
                break;

              case 'delta':
                setMessages((prev) => {
                  const lastIndex = prev.length - 1;
                  const lastMsg = prev[lastIndex];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    // Create new array with new message object (immutable update)
                    return [
                      ...prev.slice(0, lastIndex),
                      { ...lastMsg, content: lastMsg.content + event.text },
                    ];
                  }
                  return prev;
                });
                break;

              case 'tool':
                if (event.status === 'start') {
                  setCurrentTool(event.toolName);
                } else {
                  setCurrentTool(null);
                }
                break;

              case 'final':
                setMessages((prev) => {
                  const lastIndex = prev.length - 1;
                  const lastMsg = prev[lastIndex];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    return [
                      ...prev.slice(0, lastIndex),
                      {
                        ...lastMsg,
                        isStreaming: false,
                        content: event.text && !lastMsg.content ? event.text : lastMsg.content,
                      },
                    ];
                  }
                  return prev;
                });
                if (event.traceId) {
                  setTraceId(event.traceId);
                }
                break;

              case 'error':
                setMessages((prev) => {
                  const lastIndex = prev.length - 1;
                  const lastMsg = prev[lastIndex];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    return [
                      ...prev.slice(0, lastIndex),
                      {
                        ...lastMsg,
                        content: `Error: ${event.message}`,
                        isStreaming: false,
                      },
                    ];
                  }
                  return prev;
                });
                break;
            }
          } catch {
            // Ignore parse errors for incomplete lines
          }
        }
      }
    } catch (err) {
      console.error('Chat error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => {
        const lastIndex = prev.length - 1;
        const lastMsg = prev[lastIndex];
        if (lastMsg && lastMsg.role === 'assistant') {
          return [
            ...prev.slice(0, lastIndex),
            {
              ...lastMsg,
              content: `Error: ${errorMessage}`,
              isStreaming: false,
            },
          ];
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
      setCurrentTool(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as FormEvent);
    }
  };

  const newConversation = () => {
    setMessages([]);
    setConversationId(null);
    setTraceId(null);
  };

  const onFormSubmit = (e: FormEvent) => {
    void handleSubmit(e);
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>Agentic Chat</h1>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {traceId && <span className="trace-id">Trace: {traceId.slice(0, 8)}...</span>}
          <button
            onClick={newConversation}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            New Chat
          </button>
        </div>
      </header>

      <div className="messages-container">
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '40px' }}>
            <p>Start a conversation. The agent can remember information using notes.</p>
            <p style={{ fontSize: '0.875rem', marginTop: '8px' }}>
              Try: &quot;Remember that my favorite color is blue&quot;
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.role} ${message.content.startsWith('Error:') ? 'error' : ''}`}
          >
            {message.content || (message.isStreaming && <LoadingIndicator />)}
          </div>
        ))}

        {currentTool && (
          <div className="tool-indicator">Using tool: {currentTool}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="input-container" onSubmit={onFormSubmit}>
        <div className="input-wrapper">
          {images.length > 0 && (
            <div className="image-preview">
              {images.map((img) => (
                <div key={img.id} className="image-preview-item">
                  <img src={img.preview} alt="Upload preview" />
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() => removeImage(img.id)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="image-upload-container">
            <button
              type="button"
              className="image-upload-button"
              onClick={() => fileInputRef.current?.click()}
            >
              + Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          <textarea
            ref={textareaRef}
            className="message-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          className="send-button"
          disabled={isLoading || (!input.trim() && images.length === 0)}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="loading-indicator">
      <div className="loading-dot" />
      <div className="loading-dot" />
      <div className="loading-dot" />
    </div>
  );
}
