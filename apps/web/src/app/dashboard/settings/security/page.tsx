import { cookies } from "next/headers";
import { createServerApi, SESSION_COOKIE } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SecurityAuditPage() {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? "");

  let logs: any[] = [];
  let fetchError: string | null = null;

  try {
    logs = await serverApi.get<any[]>("/audit-logs");
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Could not reach API";
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Security & Audit Logs</h1>
        <p className="text-sm text-slate-600 mt-1">
          Review system activity, configuration changes, and security events.
        </p>
      </div>

      {fetchError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-100">
          Failed to load audit logs: {fetchError}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
            <tr>
              <th className="p-4">Time</th>
              <th className="p-4">User</th>
              <th className="p-4">Action</th>
              <th className="p-4">Entity</th>
              <th className="p-4">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {logs.map((log: any) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className="p-4 whitespace-nowrap text-xs text-slate-500">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="p-4 font-medium">
                  {log.user?.name || log.userEmailSnapshot || "System"}
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${
                    log.action === "create" ? "bg-green-100 text-green-700" :
                    log.action === "delete" ? "bg-red-100 text-red-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>
                    {log.action}
                  </span>
                </td>
                <td className="p-4">{log.entityType}</td>
                <td className="p-4 text-slate-500">{log.changeSummary}</td>
              </tr>
            ))}
            {logs.length === 0 && !fetchError && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  No audit logs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
