"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export function AddUserForm({ onCancel, onSuccess }: { onCancel: () => void, onSuccess: (user: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
    };

    try {
      const newUser = await api.post("/users", data);
      onSuccess(newUser);
    } catch (err: any) {
      setError(err.message || "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input required name="name" type="text" className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="John Doe" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input required name="email" type="email" className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="john@example.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
          <select required name="role" className="w-full border border-slate-300 rounded p-2 text-sm">
            <option value="Viewer">Viewer</option>
            <option value="Sales">Sales</option>
            <option value="Manager">Manager</option>
            <option value="Admin">Admin</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-slate-600 hover:text-slate-900 text-sm font-medium">Cancel</button>
        <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
          {loading ? "Inviting..." : "Invite User"}
        </button>
      </div>
    </form>
  );
}
