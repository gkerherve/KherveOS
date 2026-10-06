import {
  BookOpen, File, FileArchive, FileAudio, FileCode, FileImage, FileJson, FileSpreadsheet, FileText, FileVideo, Folder,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { extname } from './path'

interface FileIcon {
  icon: LucideIcon
  color: string
}

const BY_EXT: Record<string, FileIcon> = {}
const add = (exts: string, icon: LucideIcon, color: string) => exts.split(' ').forEach((e) => (BY_EXT[e] = { icon, color }))

add('.txt .log .md .rtf .tex .bib', FileText, '#64748b')
add('.py .js .ts .tsx .jsx .html .htm .css .sh .c .cpp .h .rs .go .java .xml .yml .yaml .toml .ini', FileCode, '#0ea5e9')
add('.json', FileJson, '#ca8a04')
add('.kbook .ipynb', BookOpen, '#f59e0b')
add('.png .jpg .jpeg .gif .webp .svg .bmp .ico', FileImage, '#10b981')
add('.csv .tsv .xlsx .xls .ods .ksheet', FileSpreadsheet, '#16a34a')
add('.mp3 .wav .ogg .flac .m4a', FileAudio, '#a855f7')
add('.mp4 .webm .mov .mkv', FileVideo, '#ec4899')
add('.zip .tar .gz .7z .rar', FileArchive, '#a16207')
add('.pdf', FileText, '#dc2626')

export function fileIcon(path: string, type: 'file' | 'dir'): FileIcon {
  if (type === 'dir') return { icon: Folder, color: 'var(--k-accent)' }
  return BY_EXT[extname(path)] ?? { icon: File, color: '#94a3b8' }
}

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']

export function mimeType(path: string): string {
  const ext = extname(path)
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.json': 'application/json', '.csv': 'text/csv', '.py': 'text/x-python',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.zip': 'application/zip',
  }
  return map[ext] ?? 'application/octet-stream'
}
