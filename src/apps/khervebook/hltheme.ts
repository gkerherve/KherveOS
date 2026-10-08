// Highlight themes for Python code cells (desktop hltheme.py): "Auto (app
// theme)" keeps the built-in VS Code-like palette of the app's light or dark
// look; the named themes pin a classic editor scheme with its own
// background. Chosen from a code cell's right-click menu; kept per browser.

import { create } from 'zustand'

export const AUTO = 'Auto (app theme)'

type Tokens = Record<'keyword' | 'control' | 'constant' | 'builtin' | 'decorator' | 'defname' | 'classname' | 'call' | 'selfcls' | 'number' | 'string' | 'comment', string>

export const AUTO_LIGHT: Tokens = {
  keyword: '#0000ff', control: '#af00db', constant: '#0070c1', builtin: '#267f99', decorator: '#b5730a', defname: '#795e26',
  classname: '#267f99', call: '#795e26', selfcls: '#0e8a9c', number: '#098658', string: '#a31515', comment: '#6e7781',
}
export const AUTO_DARK: Tokens = {
  keyword: '#569cd6', control: '#c586c0', constant: '#569cd6', builtin: '#4ec9b0', decorator: '#dcdcaa', defname: '#dcdcaa',
  classname: '#4ec9b0', call: '#dcdcaa', selfcls: '#9cdcfe', number: '#b5cea8', string: '#ce9178', comment: '#6a9955',
}

export const THEMES: Record<string, Tokens & { bg: string; fg: string }> = {
  Monokai: {
    bg: '#272822', fg: '#f8f8f2', keyword: '#f92672', control: '#f92672', constant: '#ae81ff', builtin: '#66d9ef', decorator: '#a6e22e',
    defname: '#a6e22e', classname: '#66d9ef', call: '#a6e22e', selfcls: '#fd971f', number: '#ae81ff', string: '#e6db74', comment: '#75715e',
  },
  Dracula: {
    bg: '#282a36', fg: '#f8f8f2', keyword: '#ff79c6', control: '#ff79c6', constant: '#bd93f9', builtin: '#8be9fd', decorator: '#50fa7b',
    defname: '#50fa7b', classname: '#8be9fd', call: '#50fa7b', selfcls: '#ffb86c', number: '#bd93f9', string: '#f1fa8c', comment: '#6272a4',
  },
  'One Dark': {
    bg: '#282c34', fg: '#abb2bf', keyword: '#c678dd', control: '#c678dd', constant: '#d19a66', builtin: '#56b6c2', decorator: '#61afef',
    defname: '#61afef', classname: '#e5c07b', call: '#61afef', selfcls: '#e06c75', number: '#d19a66', string: '#98c379', comment: '#5c6370',
  },
  Nord: {
    bg: '#2e3440', fg: '#d8dee9', keyword: '#81a1c1', control: '#81a1c1', constant: '#81a1c1', builtin: '#88c0d0', decorator: '#d08770',
    defname: '#88c0d0', classname: '#8fbcbb', call: '#88c0d0', selfcls: '#81a1c1', number: '#b48ead', string: '#a3be8c', comment: '#616e88',
  },
  'Solarized Light': {
    bg: '#fdf6e3', fg: '#657b83', keyword: '#859900', control: '#859900', constant: '#cb4b16', builtin: '#268bd2', decorator: '#b58900',
    defname: '#268bd2', classname: '#b58900', call: '#268bd2', selfcls: '#d33682', number: '#2aa198', string: '#2aa198', comment: '#93a1a1',
  },
  'Solarized Dark': {
    bg: '#002b36', fg: '#839496', keyword: '#859900', control: '#859900', constant: '#cb4b16', builtin: '#268bd2', decorator: '#b58900',
    defname: '#268bd2', classname: '#b58900', call: '#268bd2', selfcls: '#d33682', number: '#2aa198', string: '#2aa198', comment: '#586e75',
  },
  'GitHub Light': {
    bg: '#ffffff', fg: '#24292f', keyword: '#cf222e', control: '#cf222e', constant: '#0550ae', builtin: '#8250df', decorator: '#8250df',
    defname: '#8250df', classname: '#953800', call: '#8250df', selfcls: '#0550ae', number: '#0550ae', string: '#0a3069', comment: '#6e7781',
  },
}

export const themeNames = () => [AUTO, ...Object.keys(THEMES)]

const KEY = 'khervebook.hltheme'

function saved(): string {
  try {
    const v = localStorage.getItem(KEY) ?? AUTO
    return v in THEMES ? v : AUTO
  } catch {
    return AUTO
  }
}

export const useHlTheme = create<{ name: string; set: (name: string) => void }>()((set) => ({
  name: typeof localStorage === 'undefined' ? AUTO : saved(),
  set: (name) => {
    try {
      localStorage.setItem(KEY, name)
    } catch {
      /* not remembered */
    }
    set({ name })
  },
}))

/** CSS variables the editor's token colours (and, for a named theme, its background) come from. */
export function themeVars(name: string, dark: boolean): Record<string, string> {
  const named = THEMES[name]
  const t: Tokens = named ?? (dark ? AUTO_DARK : AUTO_LIGHT)
  const vars: Record<string, string> = {
    '--k-syn-keyword': t.keyword,
    '--k-syn-string': t.string,
    '--k-syn-number': t.number,
    '--k-syn-comment': t.comment,
    '--k-syn-function': t.call,
    '--k-syn-def': t.defname,
    '--k-syn-type': t.classname,
    '--k-syn-property': named ? named.fg : dark ? '#9cdcfe' : '#001080',
  }
  if (named) {
    vars['--k-bg'] = named.bg
    vars['--nb-editor'] = named.bg
    vars['--k-text'] = named.fg
    vars['--k-muted'] = named.comment
  }
  return vars
}
