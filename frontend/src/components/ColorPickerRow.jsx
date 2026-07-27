import React from "react";
import { COLUMN_COLORS, COLUMN_COLOR_KEYS } from "@/lib/columnColors";
import { Check } from "lucide-react";

export const ColorPickerRow = ({ current, onPick }) => {
    return (
        <div
            className="flex flex-wrap gap-2 p-2"
            data-testid="column-color-picker"
        >
            {COLUMN_COLOR_KEYS.map((k) => {
                const c = COLUMN_COLORS[k];
                const active = current === k;
                return (
                    <button
                        key={k}
                        data-testid={`column-color-${k}`}
                        onClick={() => onPick(k)}
                        title={c.label}
                        aria-label={`Couleur ${c.label}`}
                        className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95 ${
                            active ? "ring-2 ring-offset-2 ring-primary" : ""
                        }`}
                    >
                        <span
                            className={`w-5 h-5 rounded-full ${c.dot} flex items-center justify-center`}
                        >
                            {active && (
                                <Check
                                    size={11}
                                    className="text-white"
                                    strokeWidth={3}
                                />
                            )}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
