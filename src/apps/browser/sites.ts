// What the Browser knows about the outside web, in one place so it is easy to
// adjust: search engines, the start page's favourites, and the sites known to
// refuse being shown inside another page.

import type { LucideIcon } from 'lucide-react'
import { BookOpen, Braces, Cpu, FileCode, GraduationCap, Map as MapIcon, Wrench } from 'lucide-react'

export interface SearchEngine {
  id: string
  name: string
  /** The search address; the URL-encoded query is appended. */
  url: string
  /** False when the engine refuses to be framed: its results open in a real browser tab. */
  framable: boolean
}

// Checked 2026-10-06 (X-Frame-Options / CSP frame-ancestors, and a real frame):
// Bing and Wikipedia can be shown inside KherveOS; DuckDuckGo, Google, Brave,
// Startpage, Ecosia and Qwant refuse.
export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=', framable: true },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=', framable: true },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=', framable: false },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', framable: false },
]

/** The search engine used until the user picks another one. Change this line to switch. */
export const DEFAULT_SEARCH_ENGINE = 'bing'

export interface Favourite {
  name: string
  url: string
  icon: LucideIcon
  /** One line under the name. */
  hint: string
}

/** Start-page tiles: sites that are likely to allow being shown inside KherveOS. */
export const FAVOURITES: Favourite[] = [
  { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page', icon: BookOpen, hint: 'The free encyclopedia' },
  {
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org/export/embed.html?bbox=-10.5%2C42.0%2C10.5%2C56.5&layer=mapnik',
    icon: MapIcon,
    hint: 'A map of the world',
  },
  { name: 'Python docs', url: 'https://docs.python.org/3/', icon: FileCode, hint: 'docs.python.org' },
  { name: 'Pyodide', url: 'https://pyodide.org/en/stable/', icon: Cpu, hint: 'Python in the browser' },
  { name: 'NumPy', url: 'https://numpy.org/doc/stable/', icon: Braces, hint: 'numpy.org docs' },
  { name: 'XPS on Wikipedia', url: 'https://en.wikipedia.org/wiki/X-ray_photoelectron_spectroscopy', icon: GraduationCap, hint: 'X-ray photoelectron spectroscopy' },
  { name: 'KherveTools', url: 'https://khervetools.com', icon: Wrench, hint: 'khervetools.com' },
]

/**
 * Sites known to refuse being shown inside other pages (X-Frame-Options or
 * CSP frame-ancestors). Each entry also covers its subdomains; "name.*" covers
 * every country domain (google.fr, amazon.co.uk…). YouTube is allowed under
 * /embed/, and watch links are rewritten to youtube-nocookie.com embeds.
 */
export const FRAME_BLOCKING_SITES: string[] = [
  'google.*', 'gmail.com', 'youtube.com',
  'github.com', 'gitlab.com',
  'facebook.com', 'messenger.com', 'instagram.com', 'threads.net', 'whatsapp.com',
  'x.com', 'twitter.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'pinterest.com', 'discord.com', 'twitch.tv',
  'amazon.*', 'netflix.com', 'paypal.com', 'yahoo.com',
  'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com', 'askubuntu.com', 'mathoverflow.net',
  'microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com',
  'duckduckgo.com', 'search.brave.com', 'startpage.com', 'ecosia.org', 'qwant.com',
  'developer.mozilla.org', 'arxiv.org', 'matplotlib.org',
  'apple.com', 'icloud.com',
  'dropbox.com', 'notion.so', 'slack.com', 'zoom.us',
  'chatgpt.com', 'openai.com', 'claude.ai',
]
