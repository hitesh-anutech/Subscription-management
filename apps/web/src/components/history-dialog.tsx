'use client';

import { useState, useEffect } from 'react';
import { History, X, Clock, User, MessageSquare } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changeSummary: string;
  userEmailSnapshot: string | null;
  createdAt: string;
  user?: {
    name: string | null;
    email: string;
  } | null;
}

interface HistoryDialogProps {
  entityType: 'lead' | 'quote' | 'subscription' | 'domain';
  entityId: string;
  title?: string;
}

export function HistoryDialog({ entityType, entityId, title = 'Change Log History' }: HistoryDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/audit-logs?entityType=${entityType}&entityId=${entityId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Logs read karne me dikkat aayi');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Server error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchLogs();
    }
  }, [isOpen, entityId, entityType]);

  return (
    <>
      {/* Small History Icon Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="View logs history"
        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors duration-150 inline-flex items-center justify-center border border-slate-100 hover:border-blue-200 bg-white"
      >
        <History className="w-3.5 h-3.5" />
      </button>

      {/* Modal Popup overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-800 text-sm">{title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {loading && (
                <div className="text-center py-8 text-xs text-slate-500 font-semibold">
                  ⏳ Loading logs...
                </div>
              )}

              {error && (
                <div className="text-center py-8 text-xs text-red-600 font-bold">
                  ❌ {error}
                </div>
              )}

              {!loading && !error && logs.length === 0 && (
                <div className="text-center py-10 text-xs text-slate-400 font-semibold">
                  No records of changes found for this item.
                </div>
              )}

              {!loading && !error && logs.length > 0 && (
                <div className="relative pl-4 border-l border-slate-100 space-y-5">
                  {logs.map((log) => {
                    const date = new Date(log.createdAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const userName = log.user?.name || log.userEmailSnapshot || 'System';
                    
                    return (
                      <div key={log.id} className="relative group">
                        {/* Dot indicator */}
                        <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-blue-500 group-hover:scale-110 transition-transform shadow-sm" />
                        
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-4 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span className="flex items-center gap-1 text-slate-600">
                              <User className="w-3.5 h-3.5" /> {userName}
                            </span>
                            <span>{date}</span>
                          </div>
                          
                          <p className="text-xs font-semibold text-slate-700 leading-relaxed bg-slate-50 border border-slate-100 p-2.5 rounded-xl flex items-start gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                            <span>{log.changeSummary}</span>
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-100 transition-colors shadow-sm bg-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
