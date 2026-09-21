import {Marked, Renderer, type Tokens} from 'marked'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHref(value: string) {
  const href = value.trim()
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href
  if (/^(#|\/(?!\/)|\.\.?\/)/.test(href)) return href
  return null
}

const renderer = new Renderer()

renderer.html = ({text}: Tokens.HTML | Tokens.Tag) => escapeHtml(text)
renderer.link = function ({href, title, tokens}: Tokens.Link) {
  const label = this.parser.parseInline(tokens)
  const safe = safeHref(href)
  if (!safe) return label
  const external = /^https?:\/\//i.test(safe) ? ' target="_blank" rel="noopener noreferrer"' : ''
  const linkTitle = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(safe)}"${linkTitle}${external}>${label}</a>`
}
renderer.image = ({href, title, text}: Tokens.Image) => {
  const safe = safeHref(href)
  if (!safe) return escapeHtml(text)
  const imageTitle = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(text)}"${imageTitle} loading="lazy">`
}

const markdown = new Marked()
markdown.use({
  extensions: [{
    name: 'messageCitation',
    level: 'inline',
    start(source: string) { return source.indexOf('[#') },
    tokenizer(source: string) {
      const match = /^\[#(\d+)\]/.exec(source)
      if (!match) return undefined
      return {type: 'messageCitation', raw: match[0], messageId: match[1]}
    },
    renderer(token) {
      const messageId = String((token as {messageId?: unknown}).messageId || '')
      return `<button type="button" class="message-citation" data-message-id="${messageId}" title="查看消息 #${messageId} 上下文">#${messageId}</button>`
    },
  }],
})
markdown.setOptions({
  async: false,
  breaks: true,
  gfm: true,
  renderer,
})

export function renderMarkdown(source: string) {
  return markdown.parse(source.replace(/\u0000/g, ''), {async: false})
}
