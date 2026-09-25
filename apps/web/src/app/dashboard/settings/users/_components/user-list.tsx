"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { AddUserForm } from "./add-user-form";

function ActionsMenu({ userId, onResetPassword, onResendInvite }: {
  userId: string;
  onResetPassword: (id: string) => void;
  onResendInvite: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-slate-500 hover:text-slate-800 p-1 rounded hover:bg-slate-100"
        title="Actions"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          <button
            onClick={() => { setOpen(false); onResetPassword(userId); }}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            Reset Password
          </button>
          <button
            onClick={() => { setOpen(false); onResendInvite(userId); }}
            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Resend Invite
          </button>
        </div>
      )}
    </div>
  );
}

export function UserList({ initialUsers }: { initialUsers: any[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [isAdding, setIsAdding] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleUserAdded = (newUser: any) => {
    setUsers([...users, newUser]);
    setIsAdding(false);
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const updated = await api.put(`/users/${userId}`, { role: newRole });
      setUsers(users.map(u => (u.id === userId ? updated : u)));
    } catch (err) {
      alert("Failed to update role");
    }
  };

  const handleResetPassword = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!confirm(`Reset password for ${user?.name || "this user"}? A new temporary password will be emailed to ${user?.email}.`)) return;
    setLoadingId(userId);
    try {
      await api.post(`/users/${userId}/resend-invite`);
      alert("Password reset successfully! A new temporary password has been sent to the user's email.");
    } catch (err) {
      alert("Failed to reset password. Please check SMTP settings.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleResendInvite = async (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!confirm(`Resend invite to ${user?.name || "this user"} at ${user?.email}?`)) return;
    setLoadingId(userId);
    try {
      await api.post(`/users/${userId}/resend-invite`);
      alert("Invite resent successfully!");
    } catch (err) {
      alert("Failed to resend invite.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setIsAdding(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 font-medium"
        >
          + Invite User
        </button>
      </div>

      {isAdding && (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm mb-6">
          <h3 className="font-semibold text-lg mb-4">Invite New User</h3>
          <AddUserForm onCancel={() => setIsAdding(false)} onSuccess={handleUserAdded} />
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
            <tr>
              <th className="p-4">Name</th>
              <th className="p-4">Email</th>
              <th className="p-4">Role</th>
              <th className="p-4">Status</th>
              <th className="p-4">Joined</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {users.map(user => (
              <tr key={user.id} className={`hover:bg-slate-50 ${loadingId === user.id ? "opacity-50 pointer-events-none" : ""}`}>
                <td className="p-4 font-medium">{user.name}</td>
                <td className="p-4">{user.email}</td>
                <td className="p-4">
                  <select
                    className="border border-slate-300 rounded p-1 text-sm"
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                  >
                    <option value="Admin">Admin</option>
                    <option value="Sales">Sales</option>
                    <option value="Manager">Manager</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${user.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"}`}>
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="p-4 text-slate-500 text-xs">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="p-4 text-right">
                  <ActionsMenu
                    userId={user.id}
                    onResetPassword={handleResetPassword}
                    onResendInvite={handleResendInvite}
                  />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
