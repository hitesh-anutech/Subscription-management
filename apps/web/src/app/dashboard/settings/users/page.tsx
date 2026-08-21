import { cookies } from "next/headers";
import { createServerApi, SESSION_COOKIE } from "@/lib/api";
import { UserList } from "./_components/user-list";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const cookieStore = await cookies();
  const serverApi = createServerApi(cookieStore.get(SESSION_COOKIE)?.value ?? "");

  let users: any[] = [];
  let fetchError: string | null = null;

  try {
    users = await serverApi.get<any[]>("/users");
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Could not reach API";
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Users & Roles</h1>
        <p className="text-sm text-slate-600 mt-1">
          Manage system access, invite new users, and assign roles.
        </p>
      </div>

      {fetchError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-100">
          Failed to load users: {fetchError}
        </div>
      )}

      {!fetchError && <UserList initialUsers={users} />}
    </div>
  );
}
