'use client';

import { useOptimistic, useTransition, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import {
  addListItemAction,
  toggleListItemAction,
  deleteListItemAction,
} from '../actions';

export interface ListItem {
  id: string;
  itemValue: string;
  itemLabel: string | null;
  isActive: boolean;
  isSystem: boolean;
  displayOrder: number;
}

function AddBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold transition-colors whitespace-nowrap">
      {pending ? 'Adding…' : '+ Add'}
    </button>
  );
}

interface Props {
  listType: string;
  title: string;
  description?: string;
  items: ListItem[];
}

export function EditableList({ listType, title, description, items: initialItems }: Props) {
  const [items, setOptimisticItems] = useOptimistic(initialItems);
  const [, startTransition] = useTransition();
  const valueRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  const [addState, addAction] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      addListItemAction(listType, fd),
    null,
  );

  const handleToggle = (id: string, current: boolean) => {
    startTransition(async () => {
      setOptimisticItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, isActive: !current } : i)),
      );
      await toggleListItemAction(listType, id, !current);
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      setOptimisticItems((prev) => prev.filter((i) => i.id !== id));
      await deleteListItemAction(listType, id);
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>

      <ul className="divide-y divide-slate-50">
        {items.length === 0 && (
          <li className="px-5 py-3 text-sm text-slate-400 italic">No items yet</li>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            className={`flex items-center justify-between px-5 py-2.5 ${
              item.isActive ? '' : 'bg-slate-50 opacity-60'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => handleToggle(item.id, item.isActive)}
                title={item.isActive ? 'Deactivate' : 'Activate'}
                className={`w-8 h-4.5 rounded-full transition-colors shrink-0 ${
                  item.isActive ? 'bg-green-500' : 'bg-slate-300'
                }`}
                style={{ height: '18px', width: '32px' }}
              />
              <span className="text-sm text-slate-700 truncate">
                {item.itemLabel ?? item.itemValue}
              </span>
              <span className="text-xs text-slate-400 font-mono">{item.itemValue}</span>
              {item.isSystem && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 shrink-0">
                  system
                </span>
              )}
            </div>
            {!item.isSystem && (
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                className="ml-3 text-slate-400 hover:text-red-500 shrink-0 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Add form */}
      <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
        {addState?.error && (
          <p className="text-xs text-red-600 mb-2">{addState.error}</p>
        )}
        <form action={addAction} className="flex gap-2">
          <input
            ref={valueRef}
            name="item_value"
            type="text"
            placeholder="Value (e.g. cold_call)"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
          <input
            ref={labelRef}
            name="item_label"
            type="text"
            placeholder="Label (e.g. Cold Call)"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <AddBtn />
        </form>
      </div>
    </div>
  );
}
