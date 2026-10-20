export interface FeedItem {
  id: string;
  title: string;
  link: string;
}

export interface FeedSummary {
  title: string;
  items: FeedItem[];
}

const decode = (value: string): string =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .trim();

const tag = (block: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match ? decode(match[1]) : undefined;
};

/** Minimal RSS 2.0 / Atom reader (the Workers runtime has no DOMParser). */
export function parseFeed(xml: string): FeedSummary {
  const atom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const head = xml.slice(0, xml.search(atom ? /<entry[\s>]/i : /<item[\s>]/i) >>> 0 || undefined);
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const link = atom
      ? /<link[^>]*?href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1] ?? ''
      : tag(block, 'link') ?? '';
    const id = tag(block, atom ? 'id' : 'guid') ?? link;
    const title = tag(block, 'title') ?? '';
    if (id) items.push({ id, title, link: decode(link) });
  }
  return { title: tag(head, 'title') ?? '', items };
}
