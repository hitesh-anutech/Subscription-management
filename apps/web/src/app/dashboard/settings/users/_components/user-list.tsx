"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { AddUserForm } from "./add-user-form";

export function UserList({ initialUsers }: { initialUsers: any[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [isAdding, setIsAdding] = useState(false);

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

  const handleResendInvite = async (userId: string) => {
    if (!confirm("Are you sure you want to reset this user's password and resend the invite?")) return;
    try {
      await api.post(`/users/${userId}/resend-invite`);
      alert("Invite resent successfully!");
    } catch (err) {
      alert("Failed to resend invite.");
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
              <tr key={user.id} className="hover:bg-slate-50">
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
                  <button 
                    onClick={() => handleResendInvite(user.id)}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 border border-blue-200 rounded hover:bg-blue-50"
                  >
                    Resend Invite
                  </button>
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
