export type FormatKind = "bold" | "italic" | "code" | "codeblock" | "bullets" | "checklist" | "link" | "heading";

export interface Edit {
  text: string;
  start: number;
  end: number;
}

function wrap(text: string, s: number, e: number, mark: string, placeholder: string): Edit {
  const sel = text.slice(s, e);
  if (!sel) {
    const t = text.slice(0, s) + mark + placeholder + mark + text.slice(e);
    return { text: t, start: s + mark.length, end: s + mark.length + placeholder.length };
  }
  const t = text.slice(0, s) + mark + sel + mark + text.slice(e);
  return { text: t, start: s + mark.length, end: e + mark.length };
}

function prefixLines(text: string, s: number, e: number, prefix: string, strip: RegExp): Edit {
  const from = text.lastIndexOf("\n", s - 1) + 1;
  const nl = text.indexOf("\n", e);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split("\n");
  const allHave = lines.every((l) => l.startsWith(prefix));
  const next = lines.map((l) => (allHave ? l.slice(prefix.length) : prefix + l.replace(strip, "")));
  const block = next.join("\n");
  return { text: text.slice(0, from) + block + text.slice(to), start: from, end: from + block.length };
}

export function applyFormat(kind: FormatKind, text: string, s: number, e: number): Edit {
  switch (kind) {
    case "bold":
      return wrap(text, s, e, "**", "bold");
    case "italic":
      return wrap(text, s, e, "*", "italic");
    case "code":
      return wrap(text, s, e, "`", "code");
    case "codeblock": {
      const sel = text.slice(s, e) || "code";
      const open = "```\n";
      const t = text.slice(0, s) + open + sel + "\n```" + text.slice(e);
      return { text: t, start: s + open.length, end: s + open.length + sel.length };
    }
    case "bullets":
      return prefixLines(text, s, e, "- ", /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?)/);
    case "checklist":
      return prefixLines(text, s, e, "- [ ] ", /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?)/);
    case "heading":
      return prefixLines(text, s, e, "## ", /^#{1,6}\s+/);
    case "link": {
      const sel = text.slice(s, e) || "text";
      const url = "url";
      const t = text.slice(0, s) + "[" + sel + "](" + url + ")" + text.slice(e);
      const us = s + sel.length + 3;
      return { text: t, start: us, end: us + url.length };
    }
  }
}
