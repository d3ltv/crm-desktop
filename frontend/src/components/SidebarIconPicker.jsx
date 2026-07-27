import React, { useMemo, useState } from "react";
import {
    Activity,
    Archive,
    Award,
    Banknote,
    BarChart3,
    Bell,
    BookOpen,
    Bookmark,
    Box,
    Briefcase,
    Building,
    Building2,
    Calculator,
    Calendar,
    Camera,
    Car,
    CheckCircle2,
    ClipboardList,
    Clock,
    Cloud,
    Code2,
    Coffee,
    Compass,
    CreditCard,
    Database,
    Factory,
    FileText,
    Film,
    Flag,
    Flame,
    Folder,
    FolderOpen,
    Gift,
    Globe,
    GraduationCap,
    Hammer,
    Handshake,
    Headphones,
    Heart,
    Home,
    Hotel,
    Image,
    Inbox,
    Key,
    Landmark,
    Layers,
    LayoutGrid,
    Leaf,
    Lightbulb,
    Link2,
    List,
    Mail,
    Map,
    MapPin,
    Megaphone,
    MessageCircle,
    MessageSquare,
    Mic,
    Monitor,
    Mountain,
    Music,
    Newspaper,
    Package,
    Palette,
    PenLine,
    Phone,
    PieChart,
    Pin,
    Plane,
    Puzzle,
    Quote,
    Radio,
    Receipt,
    Rocket,
    Scale,
    Search,
    Send,
    Settings,
    Share2,
    Shield,
    Ship,
    ShoppingBag,
    ShoppingCart,
    Smile,
    Sparkles,
    Star,
    Store,
    Sun,
    Table2,
    Tag,
    Target,
    Tent,
    ThumbsUp,
    Ticket,
    Timer,
    Train,
    Trash2,
    Trello,
    Truck,
    Tv,
    Umbrella,
    UserRound,
    Users,
    Video,
    Wallet,
    Warehouse,
    Wifi,
    Wine,
    Wrench,
    Zap,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const SIDEBAR_EMOJIS = [
    "📁", "📂", "🏠", "🏡", "🏢", "🏬", "🏭", "🏗️", "🏛️", "🏪",
    "💼", "🎯", "⭐", "🌟", "✨", "🔥", "💡", "🚀", "🛸", "🛰️",
    "📊", "📈", "📉", "📞", "📱", "✉️", "📧", "📨", "🤝", "👥",
    "👤", "🧑‍💻", "👩‍💼", "👨‍💼", "🛠️", "⚙️", "🧰", "🔧", "🧩", "💎",
    "🏆", "🥇", "🎖️", "📌", "📍", "🗓️", "📅", "⏰", "💰", "💵",
    "💶", "💷", "💳", "🛒", "🛍️", "🌍", "🌎", "🌏", "✅", "☑️",
    "⚡", "❤️", "💙", "💚", "🧡", "💜", "🖤", "🤍", "📎", "🔗",
    "📝", "📋", "📁", "🗂️", "🔑", "🔒", "🔓", "🛡️", "🎧", "🎤",
    "🎬", "🎮", "🎲", "🚗", "🚕", "🚌", "✈️", "🛫", "🚢", "🚂",
    "☕", "🍕", "🍔", "🥗", "🎓", "📚", "📰", "🏷️", "🔔", "📣",
];

export const LUCIDE_ICONS = {
    Activity,
    Archive,
    Award,
    Banknote,
    BarChart3,
    Bell,
    BookOpen,
    Bookmark,
    Box,
    Briefcase,
    Building,
    Building2,
    Calculator,
    Calendar,
    Camera,
    Car,
    CheckCircle2,
    ClipboardList,
    Clock,
    Cloud,
    Code2,
    Coffee,
    Compass,
    CreditCard,
    Database,
    Factory,
    FileText,
    Film,
    Flag,
    Flame,
    Folder,
    FolderOpen,
    Gift,
    Globe,
    GraduationCap,
    Hammer,
    Handshake,
    Headphones,
    Heart,
    Home,
    Hotel,
    Image,
    Inbox,
    Key,
    Landmark,
    Layers,
    LayoutGrid,
    Leaf,
    Lightbulb,
    Link2,
    List,
    Mail,
    Map,
    MapPin,
    Megaphone,
    MessageCircle,
    MessageSquare,
    Mic,
    Monitor,
    Mountain,
    Music,
    Newspaper,
    Package,
    Palette,
    PenLine,
    Phone,
    PieChart,
    Pin,
    Plane,
    Puzzle,
    Quote,
    Radio,
    Receipt,
    Rocket,
    Scale,
    Search,
    Send,
    Settings,
    Share2,
    Shield,
    Ship,
    ShoppingBag,
    ShoppingCart,
    Smile,
    Sparkles,
    Star,
    Store,
    Sun,
    Table2,
    Tag,
    Target,
    Tent,
    ThumbsUp,
    Ticket,
    Timer,
    Train,
    Trash2,
    Trello,
    Truck,
    Tv,
    Umbrella,
    UserRound,
    Users,
    Video,
    Wallet,
    Warehouse,
    Wifi,
    Wine,
    Wrench,
    Zap,
};

export function SidebarIconDisplay({ icon, fallback, size = 16, className }) {
    if (icon?.kind === "emoji" && icon.value) {
        return (
            <span
                className={cn("leading-none select-none", className)}
                style={{ fontSize: Math.max(12, size) }}
                aria-hidden
            >
                {icon.value}
            </span>
        );
    }
    if (icon?.kind === "lucide" && icon.value) {
        const Cmp = LUCIDE_ICONS[icon.value];
        if (Cmp) return <Cmp size={size} className={className} aria-hidden />;
    }
    return fallback ?? null;
}

export function SidebarIconPickerContent({ icon, onChange, className }) {
    const [tab, setTab] = useState("emoji");
    const [query, setQuery] = useState("");

    const lucideNames = useMemo(() => {
        const names = Object.keys(LUCIDE_ICONS);
        const q = query.trim().toLowerCase();
        if (!q) return names;
        return names.filter((n) => n.toLowerCase().includes(q));
    }, [query]);

    const emojisFiltered = useMemo(() => {
        const q = query.trim();
        if (!q || tab !== "emoji") return SIDEBAR_EMOJIS;
        return SIDEBAR_EMOJIS.filter((em) => em.includes(q));
    }, [query, tab]);

    const pick = (next) => {
        onChange?.(next);
        setQuery("");
    };

    return (
        <div className={cn("w-72 p-2", className)}>
            <div className="flex gap-1 mb-2">
                {[
                    { id: "emoji", label: "Emoji" },
                    { id: "lucide", label: "Icône" },
                ].map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                            setTab(t.id);
                            setQuery("");
                        }}
                        className={cn(
                            "flex-1 h-7 rounded-md text-xs font-medium transition-colors",
                            tab === t.id
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-secondary",
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "lucide" ? "Rechercher une icône…" : "Filtrer…"}
                className="w-full h-8 mb-2 px-2 rounded-md border border-border/60 bg-background text-xs outline-none focus:ring-1 focus:ring-primary/40"
                onKeyDown={(e) => e.stopPropagation()}
            />

            <div className="grid grid-cols-8 gap-1 max-h-56 overflow-y-auto no-scrollbar">
                {tab === "emoji"
                    ? emojisFiltered.map((em, i) => (
                          <button
                              key={`${em}-${i}`}
                              type="button"
                              onClick={() => pick({ kind: "emoji", value: em })}
                              className={cn(
                                  "h-8 rounded-md text-base hover:bg-secondary flex items-center justify-center",
                                  icon?.kind === "emoji" && icon.value === em && "bg-primary/10",
                              )}
                              aria-label={`Emoji ${em}`}
                          >
                              {em}
                          </button>
                      ))
                    : lucideNames.map((name) => {
                          const Cmp = LUCIDE_ICONS[name];
                          return (
                              <button
                                  key={name}
                                  type="button"
                                  title={name}
                                  onClick={() => pick({ kind: "lucide", value: name })}
                                  className={cn(
                                      "h-8 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground",
                                      icon?.kind === "lucide" &&
                                          icon.value === name &&
                                          "bg-primary/10 text-primary",
                                  )}
                                  aria-label={name}
                              >
                                  <Cmp size={15} />
                              </button>
                          );
                      })}
            </div>

            <button
                type="button"
                onClick={() => pick(null)}
                className="mt-2 w-full h-7 rounded-md text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
                Réinitialiser
            </button>
        </div>
    );
}

/** Picker autonome (clic direct sur l’icône) — non contrôlé depuis le menu. */
export function SidebarIconPicker({
    icon,
    onChange,
    children,
    side = "right",
    align = "start",
}) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                side={side}
                align={align}
                className="w-auto p-0"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <SidebarIconPickerContent
                    icon={icon}
                    onChange={(next) => {
                        onChange?.(next);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
