'use client';

import { useState, useCallback, useRef } from 'react';

/**
 * Renders text with `truncate` clipping. On hover, shows a styled fixed-position
 * tooltip with the full text — bypasses any parent `overflow: hidden` container.
 * Tooltip is suppressed when the text isn't actually overflowing.
 */
export function TruncatedTooltip({
  text,
  className = '',
  maxWidth = 'max-w-[192px]',
}: {
  text: string;
  className?: string;
  maxWidth?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return; // not truncated — skip tooltip
    const rect = el.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.bottom + 6 });
  }, []);

  const handleMouseLeave = useCallback(() => setPos(null), []);

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`block truncate cursor-default ${maxWidth} ${className}`}
      >
        {text}
      </span>

      {pos && (
        <div
          className="fixed z-[9999] bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none max-w-sm whitespace-normal leading-relaxed"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </div>
      )}
    </>
  );
}
