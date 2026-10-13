// Render a safe subset of Markdown: raw HTML is always text, and links allow HTTP(S) only.
export function renderAnswerMarkdown(value, escapeHtml) {
  const attribute = value => escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function inline(value, depth = 0) {
    if (depth > 5) return escapeHtml(value);
    const pattern = /(`+)([^`]+?)\1|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
    let html = '', offset = 0;
    for (const match of value.matchAll(pattern)) {
      html += escapeHtml(value.slice(offset, match.index));
      if (match[1]) html += `<code>${escapeHtml(match[2])}</code>`;
      else if (match[3] || match[4]) html += `<strong>${inline(match[3] || match[4], depth + 1)}</strong>`;
      else if (match[5] || match[6]) html += `<em>${inline(match[5] || match[6], depth + 1)}</em>`;
      else if (/^https?:\/\//i.test(match[8]) && !/[\u0000-\u001f\u007f]/.test(match[8])) html += `<a href="${attribute(match[8])}" target="_blank" rel="noopener noreferrer">${inline(match[7], depth + 1)}</a>`;
      else html += escapeHtml(match[7]);
      offset = match.index + match[0].length;
    }
    return html + escapeHtml(value.slice(offset));
  }
  const listItem = line => /^(\s*)([-+*]|\d+[.)、])\s+(.+)$/.exec(line);
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  const tableSeparator = line => line?.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell));
  const heading = line => /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
  function list(lines, start, depth) {
    const first = listItem(lines[start]), indent = first[1].length, ordered = /^\d/.test(first[2]);
    const tag = ordered ? 'ol' : 'ul', number = ordered ? parseInt(first[2], 10) : 1;
    let html = `<${tag}${ordered && number !== 1 ? ` start="${number}"` : ''}>`, index = start;
    while (index < lines.length) {
      const item = listItem(lines[index]);
      if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
      html += `<li>${inline(item[3])}`; index++;
      while (index < lines.length) {
        if (!lines[index].trim()) {
          if (listItem(lines[index + 1] || '')?.[1].length >= indent) { index++; continue; }
          break;
        }
        const nested = listItem(lines[index]);
        if (nested && nested[1].length > indent && depth < 8) {
          const result = list(lines, index, depth + 1); html += result.html; index = result.index;
        } else if (!nested && /^\s+\S/.test(lines[index]) && lines[index].match(/^\s*/)[0].length > indent) {
          html += `<br>${inline(lines[index].trim())}`; index++;
        } else break;
      }
      html += '</li>';
    }
    return { html: html + `</${tag}>`, index };
  }
  function blocks(lines, depth = 0) {
    if (depth > 8) return `<p>${inline(lines.join('\n')).replace(/\n/g, '<br>')}</p>`;
    let html = '', index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index++; continue; }
      const fence = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        const code = []; index++;
        while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
        if (index < lines.length) index++;
        html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`; continue;
      }
      const title = heading(line), boldTitle = /^\s*\*\*([^*\n]{1,60})\*\*[:：]?\s*$/.exec(line);
      if (title || boldTitle) {
        const level = title ? Math.min(4, title[1].length + 1) : 3;
        html += `<h${level}>${inline(title ? title[2] : boldTitle[1])}</h${level}>`; index++; continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += '<hr>'; index++; continue; }
      if (/^\s*>/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ''));
        html += `<blockquote>${blocks(quote, depth + 1)}</blockquote>`; continue;
      }
      if (listItem(line)) { const result = list(lines, index, depth); html += result.html; index = result.index; continue; }
      if (line.includes('|') && tableSeparator(lines[index + 1])) {
        const header = cells(line); index += 2;
        html += `<div class="answer-table-scroll"><table><thead><tr>${header.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>`;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          const row = cells(lines[index++]);
          html += `<tr>${header.map((_, column) => `<td>${inline(row[column] || '')}</td>`).join('')}</tr>`;
        }
        html += '</tbody></table></div>'; continue;
      }
      const paragraph = [line]; index++;
      while (index < lines.length && lines[index].trim() && !heading(lines[index]) && !listItem(lines[index]) &&
          !/^\s*(?:>|`{3,}|~{3,}|-{3,}$|\*{3,}$|_{3,}$)/.test(lines[index]) &&
          !/^\s*\*\*([^*\n]{1,60})\*\*[:：]?\s*$/.test(lines[index]) && !tableSeparator(lines[index + 1])) paragraph.push(lines[index++]);
      html += `<p>${paragraph.map(text => inline(text)).join('<br>')}</p>`;
    }
    return html;
  }
  return blocks(String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
}
