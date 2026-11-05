import { useEffect, useRef, useState, type MouseEvent } from "react";
import { call, openExternal } from "../lib/ipc";

const cache = new Map<string, string>();

function remember(md: string, html: string) {
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
  cache.set(md, html);
}

interface Props {
  md: string;
  className?: string;
  onToggleCheck?: (index: number) => void;
}

export function Markdown({ md, className = "", onToggleCheck }: Props) {
  const [html, setHtml] = useState(() => cache.get(md) ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hit = cache.get(md);
    if (hit !== undefined) {
      setHtml(hit);
      return;
    }
    let alive = true;
    void call<string>("render_markdown", { md }).then((h) => {
      remember(md, h);
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [md]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const check = target.closest<HTMLElement>("[data-check]");
    if (check) {
      e.preventDefault();
      e.stopPropagation();
      if (onToggleCheck) onToggleCheck(Number(check.dataset.check));
      return;
    }
    const copy = target.closest<HTMLElement>("[data-copy]");
    if (copy) {
      e.preventDefault();
      const fig = copy.closest("figure");
      const lines = Array.from(fig?.querySelectorAll(".md-code-text > div") ?? []).map((d) => d.textContent ?? "");
      void navigator.clipboard
        ?.writeText(lines.join("\n"))
        .then(() => {
          copy.textContent = "Copied";
          setTimeout(() => {
            copy.textContent = "Copy";
          }, 1500);
        })
        .catch(() => undefined);
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      e.preventDefault();
      openExternal(link.getAttribute("href") ?? "");
    }
  };

  return <div ref={ref} className={`md ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
