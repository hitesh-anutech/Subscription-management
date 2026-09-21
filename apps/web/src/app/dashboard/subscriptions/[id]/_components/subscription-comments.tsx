'use client';

import { useState, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface Comment {
  id: string;
  text: string;
  createdByEmail: string;
  createdAt: string;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function initials(email: string) {
  const name = email.split('@')[0];
  const parts = name.split(/[._-]/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export function SubscriptionComments({
  subscriptionId,
  initialComments,
}: {
  subscriptionId: string;
  initialComments: Comment[];
}) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json() as Comment & { message?: string };
      if (!res.ok) throw new Error((data as { message?: string }).message ?? 'Failed to post');
      setComments(prev => [...prev, data]);
      setText('');
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error posting comment');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    setDeletingId(commentId);
    try {
      const res = await fetch(`${API_BASE}/subscriptions/${subscriptionId}/comments/${commentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch {
      setError('Failed to delete comment');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <span className="text-base">💬</span>
        <h2 className="text-sm font-semibold text-slate-700">Comments</h2>
        {comments.length > 0 && (
          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
            {comments.length}
          </span>
        )}
      </div>

      {/* Timeline */}
      {comments.length > 0 ? (
        <div className="divide-y divide-slate-50">
          {comments.map(c => (
            <div key={c.id} className="px-5 py-3.5 flex gap-3 group">
              {/* Avatar */}
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {initials(c.createdByEmail)}
              </div>
              {/* Body */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-700">{c.createdByEmail.split('@')[0]}</span>
                  <span className="text-[10px] text-slate-400">{fmtDateTime(c.createdAt)}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">{c.text}</p>
              </div>
              {/* Delete */}
              <button
                onClick={() => void handleDelete(c.id)}
                disabled={deletingId === c.id}
                title="Delete comment"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 disabled:opacity-30 shrink-0 mt-0.5"
              >
                {deletingId === c.id ? (
                  <span className="inline-block w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-6 text-center text-xs text-slate-400">
          No comments yet. Payment follow-ups, changes, aur notes yahan add karo.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mx-5 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">✕</button>
        </div>
      )}

      {/* Add comment */}
      <div className="px-5 py-3.5 border-t border-slate-100 flex gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handlePost();
          }}
          placeholder="Comment likhao… (Ctrl+Enter to post)"
          rows={2}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 placeholder:text-slate-300"
        />
        <button
          onClick={() => void handlePost()}
          disabled={!text.trim() || posting}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors self-end"
        >
          {posting ? (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : 'Post'}
        </button>
      </div>
    </div>
  );
}
