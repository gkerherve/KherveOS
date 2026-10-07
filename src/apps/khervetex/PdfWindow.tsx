// The PDF window of a KherveTeX main window — the desktop's _PdfWindow: a
// separate window holding the "PDF" tab, beside the editor (or on a second
// screen). It follows every compile. Closing it docks the PDF back beside the
// editor; closing the main window closes it.

import { useEffect, useRef } from 'react'
import { os, type AppProps } from '@/os'
import { PdfView } from './ui/PdfView'
import { usePdfLinks, getLink } from './pdfLink'
import './khervetex.css'

export default function PdfWindow({ win, mainId }: AppProps & { mainId: string }) {
  const link = usePdfLinks((s) => s.links[mainId])
  const closingByMain = useRef(false)

  // Gone or told to close by the main window: close without asking.
  useEffect(() => {
    if (!link || link.closing || (link.pdfWinId && link.pdfWinId !== win.id)) {
      closingByMain.current = true
      win.close(true)
    }
  }, [link, win])

  useEffect(() => {
    win.setTitle(`${link?.title ?? 'KherveTeX'} — PDF`)
  }, [win, link?.title])

  // The menu bar shows the main window's menus over this window too, as on the desktop.
  useEffect(() => {
    win.setMenus(link?.menus ?? null)
  }, [win, link?.menus])
  useEffect(() => () => win.setMenus(null), [win])

  // Closed by the user: the main window docks the PDF back beside the editor.
  useEffect(
    () => () => {
      if (!closingByMain.current) getLink(mainId)?.onUserClose()
    },
    [mainId],
  )

  if (!link) return <div className="k-app ktx-app" />
  return (
    <div className="k-app ktx-app ktx-pdfwin">
      <div className="ktx-tabbar">
        <button className="ktx-tab active">PDF</button>
      </div>
      <div className="ktx-tabpane">
        <PdfView
          bytes={link.pdf?.bytes ?? null}
          zoom={link.zoom}
          fit={link.fit}
          notice={link.notice}
          compiling={link.compiling}
          reveal={link.reveal}
          onFitZoom={(pct) => getLink(mainId)?.onFitZoom(pct)}
          onContextMenu={(e, _page, text) =>
            os.contextMenu(e, [
              { label: 'Show in Visual', onClick: () => getLink(mainId)?.showIn('visual', text) },
              { label: 'Show in Code', onClick: () => getLink(mainId)?.showIn('code', text) },
            ])
          }
        />
      </div>
    </div>
  )
}
