'use client';

import { useState, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { saveTemplateAction } from '../actions';

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors"
    >
      {pending ? 'Saving…' : 'Save Template'}
    </button>
  );
}

interface Props {
  templateKey: string;
  subject: string;
  bodyHtml: string;
  availablePlaceholders: string[];
}

export function TemplateEditor({
  templateKey,
  subject,
  bodyHtml,
  availablePlaceholders,
}: Props) {
  const [currentSubject, setCurrentSubject] = useState(subject);
  const [currentBody, setCurrentBody] = useState(bodyHtml);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body');

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [state, formAction] = useFormState(
    async (
      _prev: { error?: string; success?: boolean } | null,
      formData: FormData,
    ) => saveTemplateAction(templateKey, formData),
    null,
  );

  function insertPlaceholder(placeholder: string) {
    const token = `{{${placeholder}}}`;

    if (focusedField === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + token + el.value.slice(end);
      setCurrentSubject(newVal);
      setTimeout(() => {
        el.setSelectionRange(start + token.length, start + token.length);
        el.focus();
      }, 0);
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + token + el.value.slice(end);
      setCurrentBody(newVal);
      setTimeout(() => {
        el.setSelectionRange(start + token.length, start + token.length);
        el.focus();
      }, 0);
    }
  }

  return (
    <div className="space-y-5">
      {/* Status messages */}
      {state?.error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          ✅ Template save हो गई!
        </div>
      )}

      {/* Placeholder chips */}
      {availablePlaceholders.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-2.5 uppercase tracking-wide">
            Available Placeholders — cursor position पर click करके insert करो
          </p>
          <div className="flex flex-wrap gap-2">
            {availablePlaceholders.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insertPlaceholder(p)}
                className="px-2.5 py-1 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs font-mono transition-colors"
              >
                {`{{${p}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <form action={formAction} className="space-y-5">
        {/* Subject */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Email Subject
          </label>
          <input
            ref={subjectRef}
            name="subject"
            type="text"
            value={currentSubject}
            onChange={(e) => setCurrentSubject(e.target.value)}
            onFocus={() => setFocusedField('subject')}
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Body with Source / Preview tabs */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex border-b border-slate-200 bg-slate-50 px-1 pt-1 gap-0.5">
            {(['edit', 'preview'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                  activeTab === tab
                    ? 'bg-white border border-b-white border-slate-200 text-slate-800 -mb-px'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'edit' ? 'HTML Source' : 'Preview'}
              </button>
            ))}
          </div>

          <div className="p-5">
            {activeTab === 'edit' ? (
              <>
                <p className="text-xs text-slate-400 mb-2">
                  HTML enter करो। Placeholders{' '}
                  <code className="font-mono bg-slate-100 px-1 rounded">{'{{this_format}}'}</code>{' '}
                  में रखो।
                </p>
                <textarea
                  ref={bodyRef}
                  name="body_html"
                  value={currentBody}
                  onChange={(e) => setCurrentBody(e.target.value)}
                  onFocus={() => setFocusedField('body')}
                  rows={18}
                  spellCheck={false}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </>
            ) : (
              <div
                className="min-h-64 p-5 border border-slate-200 rounded-lg bg-white text-sm leading-relaxed"
                dangerouslySetInnerHTML={{ __html: currentBody }}
              />
            )}
          </div>

          {/* Hidden input keeps body_html in form data when on preview tab */}
          {activeTab === 'preview' && (
            <input type="hidden" name="body_html" value={currentBody} />
          )}
        </div>

        <div className="flex items-center gap-3">
          <SaveBtn />
          <a
            href="/dashboard/settings/email/templates"
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            ← Templates List
          </a>
        </div>
      </form>
    </div>
  );
}
