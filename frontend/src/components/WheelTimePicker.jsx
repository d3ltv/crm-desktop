import React, { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const ITEM_H = 36;
const VISIBLE = 5;

function pad(n) {
    return String(n).padStart(2, "0");
}

/**
 * Roue type Apple : glisser pour choisir heure / minute (+ saisie clavier via input time).
 */
function WheelColumn({ values, value, onChange, testId, ariaLabel }) {
    const ref = useRef(null);
    const lock = useRef(false);

    const scrollToValue = useCallback((v, smooth) => {
        const el = ref.current;
        if (!el) return;
        const idx = values.indexOf(v);
        if (idx < 0) return;
        lock.current = true;
        el.scrollTo({ top: idx * ITEM_H, behavior: smooth ? "smooth" : "auto" });
        window.setTimeout(() => { lock.current = false; }, smooth ? 280 : 40);
    }, [values]);

    useEffect(() => {
        scrollToValue(value, false);
    }, [value, scrollToValue]);

    const onScroll = () => {
        if (lock.current) return;
        const el = ref.current;
        if (!el) return;
        const idx = Math.round(el.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(values.length - 1, idx));
        const next = values[clamped];
        if (next !== value) onChange(next);
    };

    const padY = ((VISIBLE - 1) / 2) * ITEM_H;

    return (
        <div className="relative flex-1 min-w-0">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-9 rounded-lg border border-primary/25 bg-primary/8 z-10"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background to-transparent z-20"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent z-20"
            />
            <div
                ref={ref}
                role="listbox"
                aria-label={ariaLabel}
                data-testid={testId}
                onScroll={onScroll}
                className="h-[180px] overflow-y-auto snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ scrollSnapType: "y mandatory" }}
            >
                <div style={{ height: padY }} />
                {values.map((v) => (
                    <button
                        key={v}
                        type="button"
                        role="option"
                        aria-selected={v === value}
                        onClick={() => {
                            onChange(v);
                            scrollToValue(v, true);
                        }}
                        className={cn(
                            "w-full flex items-center justify-center snap-center text-[17px] tabular-nums transition-colors",
                            v === value
                                ? "font-semibold text-foreground"
                                : "font-normal text-muted-foreground/55"
                        )}
                        style={{ height: ITEM_H }}
                    >
                        {pad(v)}
                    </button>
                ))}
                <div style={{ height: padY }} />
            </div>
        </div>
    );
}

/**
 * @param {{ value: string, onChange: (hhmm: string) => void, className?: string }} props
 * value = "HH:MM"
 */
export function WheelTimePicker({ value = "09:00", onChange, className }) {
    const [hh, mm] = (() => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(value || "");
        if (!m) return [9, 0];
        return [
            Math.min(23, Math.max(0, Number(m[1]))),
            Math.min(59, Math.max(0, Number(m[2]))),
        ];
    })();

    const setHour = (h) => onChange?.(`${pad(h)}:${pad(mm)}`);
    const setMinute = (m) => onChange?.(`${pad(hh)}:${pad(m)}`);

    return (
        <div className={cn("space-y-2", className)} data-testid="wheel-time-picker">
            <div className="flex items-stretch gap-1 rounded-xl border border-border bg-muted/30 p-1">
                <WheelColumn
                    values={HOURS}
                    value={hh}
                    onChange={setHour}
                    testId="wheel-hour"
                    ariaLabel="Heure"
                />
                <div className="flex items-center text-lg font-semibold text-muted-foreground px-0.5">:</div>
                <WheelColumn
                    values={MINUTES}
                    value={mm}
                    onChange={setMinute}
                    testId="wheel-minute"
                    ariaLabel="Minutes"
                />
            </div>
            <input
                type="time"
                value={`${pad(hh)}:${pad(mm)}`}
                onChange={(e) => {
                    if (e.target.value) onChange?.(e.target.value);
                }}
                className="w-full h-9 px-2 rounded-lg border border-border bg-background text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="add-cal-time-input"
                aria-label="Saisir l'heure"
            />
            <p className="text-[10px] text-muted-foreground text-center">
                Glissez les roues ou saisissez l’heure
            </p>
        </div>
    );
}
