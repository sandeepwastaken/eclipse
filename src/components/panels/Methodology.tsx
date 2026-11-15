import { Fragment, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import source from '../../content/methodology.txt?raw';

/**
 * Renders src/content/methodology.txt. Inline: **italic**, ****bold****, ******bold italic******,
 * [label](url). Blocks: "# " heading, "- " bullet, blank line = new paragraph, "//" comment.
 */
const INLINE = /(\*{6})(.+?)\*{6}|(\*{4})(.+?)\*{4}|(\*{2})(.+?)\*{2}|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++}><em>{inline(m[2])}</em></strong>);
    else if (m[3]) out.push(<strong key={k++}>{inline(m[4])}</strong>);
    else if (m[5]) out.push(<em key={k++}>{inline(m[6])}</em>);
    else out.push(<a key={k++} href={m[8]} target="_blank" rel="noreferrer">{inline(m[7])}</a>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function blocks(src: string): ReactNode[] {
  const lines = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('//'));
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{inline(para.join(' '))}</p>);
    if (list.length) out.push(<ul key={out.length}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    para = [];
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) flush();
    else if (l.startsWith('# ')) {
      flush();
      out.push(<h3 key={out.length}>{inline(l.slice(2))}</h3>);
    } else if (l.startsWith('- ')) {
      if (para.length) flush();
      list.push(l.slice(2));
    } else {
      if (list.length) flush();
      para.push(l);
    }
  }
  flush();
  return out;
}

const content = blocks(source);

export function Methodology() {
  return (
    <Sheet title="Methodology, data and limits">
      <div className="sheet-body">
        {content.map((n, i) => <Fragment key={i}>{n}</Fragment>)}
      </div>
    </Sheet>
  );
}
