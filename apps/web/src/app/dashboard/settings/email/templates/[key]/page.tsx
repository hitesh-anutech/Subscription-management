import { cookies } from 'next/headers';
import { createServerApi, SESSION_COOKIE } from '@/lib/api';
import { notFound } from 'next/navigation';
import { TemplateEditor } from '../_components/template-editor';

export const dynamic = 'force-dynamic';

interface Template {
  id: string;
  templateKey: string;
  templateName: string;
  category: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  availablePlaceholders: unknown;
  isActive: boolean;
  isSystem: boolean;
}

export async function generateMetadata({
  params,
}: {
  params: { key: string };
}) {
  return { title: `Edit Template — ${params.key}` };
}

export default async function EditTemplatePage({
  params,
}: {
  params: { key: string };
}) {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? '');

  let template: Template | null = null;
  try {
    template = await serverApi.get<Template>(
      `/settings/email/templates/${params.key}`,
    );
  } catch {
    notFound();
  }

  if (!template) notFound();

  const placeholders: string[] = Array.isArray(template.availablePlaceholders)
    ? (template.availablePlaceholders as string[])
    : [];

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Breadcrumb */}
      <div>
        <nav className="text-xs text-slate-400 mb-2 flex items-center gap-1.5">
          <a href="/dashboard/settings/email" className="hover:text-slate-600">
            Email Configuration
          </a>
          <span>›</span>
          <a
            href="/dashboard/settings/email/templates"
            className="hover:text-slate-600"
          >
            Templates
          </a>
          <span>›</span>
          <span className="text-slate-600">{template.templateName}</span>
        </nav>
        <h1 className="text-2xl font-bold text-slate-900">
          {template.templateName}
        </h1>
        <p className="text-sm text-slate-500 mt-1 flex items-center gap-3">
          <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
            {template.templateKey}
          </code>
          {template.isSystem && (
            <span className="text-xs text-amber-600">
              System template — subject और body edit कर सकते हो
            </span>
          )}
          {!template.isActive && (
            <span className="text-xs text-red-600">Inactive</span>
          )}
        </p>
      </div>

      <TemplateEditor
        templateKey={template.templateKey}
        subject={template.subject}
        bodyHtml={template.bodyHtml}
        availablePlaceholders={placeholders}
      />
    </div>
  );
}
