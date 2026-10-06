import { BookOpen, Download, FileText, Home, Image, Monitor } from 'lucide-react'
import { HOME } from '../path'

/** The shortcuts shown in the sidebar of Files and of the file dialogs. */
export const PLACES = [
  { name: 'Home', path: HOME, icon: Home },
  { name: 'Desktop', path: `${HOME}/Desktop`, icon: Monitor },
  { name: 'Documents', path: `${HOME}/Documents`, icon: FileText },
  { name: 'Downloads', path: `${HOME}/Downloads`, icon: Download },
  { name: 'Notebooks', path: `${HOME}/Notebooks`, icon: BookOpen },
  { name: 'Pictures', path: `${HOME}/Pictures`, icon: Image },
]
