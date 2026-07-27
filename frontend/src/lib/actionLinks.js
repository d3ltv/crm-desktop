// Small helpers to build actionable links (tel:, mailto:, website URL).

export function telHref(phone) {
    if (!phone) return null;
    // Keep + and digits, strip everything else
    const cleaned = String(phone).replace(/[^+\d]/g, "");
    if (!cleaned) return null;
    return `tel:${cleaned}`;
}

export function mailtoHref(email) {
    if (!email) return null;
    const trimmed = String(email).trim();
    if (!trimmed.includes("@")) return null;
    return `mailto:${trimmed}`;
}

export function websiteHref(site) {
    if (!site) return null;
    const s = String(site).trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    return `https://${s}`;
}
