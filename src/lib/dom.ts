// Tiny pure helpers shared by views. No state, no game knowledge.

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;
type Child = Node | string | number | null | undefined | false;

/** h('button', { class: 'btn', 'data-action': 'undo', onclick: fn }, 'Undo') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/**
 * fill "{moves} moves · par {par}" from vars; unknown names stay visible so mistakes are obvious.
 * "{n|tap|taps}" picks the singular when vars.n is 1, otherwise the plural.
 */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template
    .replace(/\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g, (m, k: string, one: string, many: string) => (k in vars ? (Number(vars[k]) === 1 ? one : many) : m))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** set an attribute only when it changes (keeps DOM writes minimal on every tap) */
export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
