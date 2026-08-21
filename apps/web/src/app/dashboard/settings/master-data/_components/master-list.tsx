'use client';

import { useOptimistic, useTransition } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import {
  addMasterDataItemAction,
  toggleMasterDataItemAction,
  deleteMasterDataItemAction,
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
  addPlaceholderValue?: string;
  addPlaceholderLabel?: string;
}

export function MasterList({
  listType,
  title,
  description,
  items: initialItems,
  addPlaceholderValue = 'value',
  addPlaceholderLabel = 'Label',
}: Props) {
  const [items, setOptimisticItems] = useOptimistic(initialItems);
  const [, startTransition] = useTransition();

  const [addState, addAction] = useFormState(
    async (_prev: { success?: boolean; error?: string } | null, fd: FormData) =>
      addMasterDataItemAction(listType, fd),
    null,
  );

  const handleToggle = (id: string, current: boolean) => {
    startTransition(async () => {
      setOptimisticItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, isActive: !current } : i)),
      );
      await toggleMasterDataItemAction(listType, id, !current);
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      setOptimisticItems((prev) => prev.filter((i) => i.id !== id));
      await deleteMasterDataItemAction(listType, id);
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
                role="switch"
                aria-checked={item.isActive}
                onClick={() => handleToggle(item.id, item.isActive)}
                title={item.isActive ? 'Deactivate' : 'Activate'}
                className={`shrink-0 rounded-full transition-colors ${
                  item.isActive ? 'bg-green-500' : 'bg-slate-300'
                }`}
                style={{ width: 32, height: 18 }}
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

      <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
        {addState?.error && (
          <p className="text-xs text-red-600 mb-2">{addState.error}</p>
        )}
        <form action={addAction} className="flex gap-2">
          <input
            name="item_value"
            type="text"
            placeholder={addPlaceholderValue}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          />
          <input
            name="item_label"
            type="text"
            placeholder={addPlaceholderLabel}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <AddBtn />
        </form>
      </div>
    </div>
  );
}
