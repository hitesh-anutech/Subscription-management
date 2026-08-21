'use client';

import { useState, useEffect, useRef } from 'react';

export interface EmailTemplate { email_template_id: string; name: string; selected: boolean }
export interface ContactEmailSuggestion { name: string; email: string }

/** Shape returned by any email-preview action (per-history or per-batch). */
export interface EmailPreviewResult {
  ok?: boolean;
  error?: string;
  fromEmail?: string | null;
  toMailIds?: string[];
  ccMailIds?: string[];
  bccMailIds?: string[];
  subject?: string;
  body?: string;
  emailTemplates?: EmailTemplate[];
  contactEmails?: ContactEmailSuggestion[];
}

export interface SendEmailOverride {
  toMailIds?: string[];
  ccMailIds?: string[];
  bccMailIds?: string[];
  subject?: string;
  body?: string;
}

export interface SendEmailResult { ok?: boolean; error?: string; sentTo?: string | null }

interface EmailPreview {
  fromEmail:  string | null;
  toMailIds:  string[];
  bccMailIds: string[];
  subject:    string;
  body:       string;
}

/**
 * Reusable compose-and-send modal. Callers bind their own preview/send functions
 * (per renewal-history OR per renewal-batch), so the same UI drives both flows.
 */
export function SendEmailModal({
  title,
  sendLabel,
  docLabel,
  previewFn,
  sendFn,
  onClose,
  onSent,
}: {
  title: string;
  sendLabel: string;
  docLabel: string;
  previewFn: (templateId?: string) => Promise<EmailPreviewResult>;
  sendFn: (override: SendEmailOverride) => Promise<SendEmailResult>;
  onClose: () => void;
  onSent: () => void;
}) {
  const [loading, setLoading]               = useState(true);
  const [sending, setSending]               = useState(false);
  const [sent, setSent]                     = useState(false);
  const [sentTo, setSentTo]                 = useState<string | null>(null);
  const [templateLoading, setTplLoad]       = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [preview, setPreview]               = useState<EmailPreview | null>(null);
  const [emailTemplates, setEmailTemplates]         = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [contactEmails, setContactEmails]           = useState<ContactEmailSuggestion[]>([]);

  const [toInput, setToInput]   = useState('');
  const [ccInput, setCcInput]   = useState('');
  const [bccInput, setBccInput] = useState('');
  const [subject, setSubject]   = useState('');

  const [bodyHtml, setBodyHtml]   = useState('');
  const bodyRef                   = useRef<HTMLDivElement>(null);
  const overlayRef                = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current && bodyHtml) bodyRef.current.innerHTML = bodyHtml;
  }, [bodyHtml]);

  const applyPreviewData = (res: EmailPreviewResult, isInitial = false) => {
    if (res.error) { setError(res.error); return; }
    const p: EmailPreview = {
      fromEmail:  res.fromEmail  ?? null,
      toMailIds:  res.toMailIds  ?? [],
      bccMailIds: res.bccMailIds ?? [],
      subject:    res.subject    ?? '',
      body:       res.body       ?? '',
    };
    setPreview(p);
    if (isInitial) {
      setToInput(p.toMailIds.join(', '));
      setCcInput((res.ccMailIds ?? []).join(', '));
      setBccInput(p.bccMailIds.join(', '));
      if (res.contactEmails?.length) setContactEmails(res.contactEmails);
    }
    setSubject(p.subject);
    setBodyHtml(p.body);
    if (res.emailTemplates?.length) {
      setEmailTemplates(res.emailTemplates);
      if (isInitial) {
        const sel = res.emailTemplates.find(t => t.selected);
        if (sel) setSelectedTemplateId(sel.email_template_id);
      }
    }
  };

  useEffect(() => {
    previewFn().then(res => {
      setLoading(false);
      applyPreviewData(res, true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTemplateChange = async (templateId: string) => {
    setSelectedTemplateId(templateId);
    setTplLoad(true);
    setError(null);
    const res = await previewFn(templateId);
    setTplLoad(false);
    applyPreviewData(res, false);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleSend = async () => {
    setSending(true);
    setError(null);
    const toMailIds  = toInput.split(',').map(s => s.trim()).filter(Boolean);
    const ccMailIds  = ccInput.split(',').map(s => s.trim()).filter(Boolean);
    const bccMailIds = bccInput.split(',').map(s => s.trim()).filter(Boolean);
    const finalBody  = bodyRef.current?.innerHTML ?? bodyHtml;
    if (!toMailIds.length) { setError('To email required है'); setSending(false); return; }
    const res = await sendFn({ toMailIds, ccMailIds, bccMailIds, subject, body: finalBody });
    setSending(false);
    if (res.error) { setError(res.error); return; }
    setSentTo(res.sentTo ?? toMailIds[0] ?? null);
    setSent(true);
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            {emailTemplates.length > 0 && (
              <div className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-2.5 py-1 text-xs bg-slate-50">
                <span className="text-slate-400">📄 Template:</span>
                <select
                  value={selectedTemplateId}
                  onChange={e => handleTemplateChange(e.target.value)}
                  disabled={templateLoading}
                  className="bg-transparent text-xs font-medium text-slate-700 focus:outline-none cursor-pointer disabled:opacity-50"
                >
                  {emailTemplates.map(t => (
                    <option key={t.email_template_id} value={t.email_template_id}>{t.name}</option>
                  ))}
                </select>
                {templateLoading && <span className="text-slate-400 animate-pulse ml-1">…</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {sent ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-5 px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">✅</div>
            <div>
              <p className="text-lg font-semibold text-slate-800">{docLabel} Sent!</p>
              {sentTo && (
                <p className="text-sm text-slate-500 mt-1">
                  Successfully sent to <span className="font-medium text-slate-700">{sentTo}</span>
                </p>
              )}
            </div>
            <button
              onClick={onSent}
              className="mt-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center py-16 text-slate-400 text-sm">
            Loading template…
          </div>
        ) : error && !preview ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-red-600 text-sm">{error}</p>
            <button onClick={onClose} className="text-xs text-slate-500 hover:underline">Close</button>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 space-y-3 border-b border-slate-100">
              {preview?.fromEmail && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="w-14 text-xs text-slate-400 shrink-0">From</span>
                  <span className="text-slate-600 text-sm">{preview.fromEmail}</span>
                </div>
              )}

              <div className="flex items-start gap-3 text-sm">
                <span className="w-14 text-xs text-slate-400 shrink-0 pt-2">To</span>
                <div className="flex-1 space-y-1.5">
                  <input
                    value={toInput}
                    onChange={e => setToInput(e.target.value)}
                    placeholder="email@example.com, another@example.com"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {contactEmails.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {contactEmails.map(c => (
                        <button
                          key={c.email}
                          type="button"
                          onClick={() => setToInput(v => v ? `${v}, ${c.email}` : c.email)}
                          title={`Add ${c.email} to To`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs hover:bg-blue-100 transition-colors"
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="text-blue-400">&lt;{c.email}&gt;</span>
                          <span className="text-blue-500 font-bold">+</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 text-sm">
                <span className="w-14 text-xs text-slate-400 shrink-0 pt-2">CC</span>
                <div className="flex-1 space-y-1.5">
                  <input
                    value={ccInput}
                    onChange={e => setCcInput(e.target.value)}
                    placeholder="cc@example.com"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <span className="w-14 text-xs text-slate-400 shrink-0">BCC</span>
                <input
                  value={bccInput}
                  onChange={e => setBccInput(e.target.value)}
                  placeholder="bcc@example.com"
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center gap-3 text-sm">
                <span className="w-14 text-xs text-slate-400 shrink-0">Subject</span>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[300px] border border-slate-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm text-slate-700"
              />
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              {error && <p className="text-red-600 text-sm flex-1">{error}</p>}
              <div className="flex items-center gap-3 ml-auto">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-lg transition-colors"
                >
                  {sending ? 'Sending…' : sendLabel}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
