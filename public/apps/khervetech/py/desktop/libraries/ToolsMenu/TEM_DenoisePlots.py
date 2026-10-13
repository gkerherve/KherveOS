# KherveOS: copied unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ToolsMenu/TEM_DenoisePlots.py. Regenerate with tools/export_khervetech.py.
"""
Diagnostic plots for the TEM PCA denoiser.

A small read-only window that fits PCA on the chosen image (or region) exactly
as the Denoise tab will, and shows the two things you need to pick a component
count — the same pair the XPS "PCA (Noise)" window shows:

    Explained variance ratio   how much of the variance each component holds;
                               the point where the bars flatten into the noise
                               floor is how many components are worth keeping.
    Component loadings         the principal-component patterns themselves.
                               For line-wise PCA each is a curve over the
                               pixels along a line; for patch-based PCA each is
                               a patch-sized image (a little eigen-tile).

Nothing here reconstructs or writes a sheet — that stays on the Denoise tab.
This window only informs the choice.
"""

import numpy as np
import wx
from matplotlib.backends.backend_wxagg import FigureCanvasWxAgg as FigureCanvas
from matplotlib.figure import Figure

from libraries.ToolsMenu.TEM_Engine import pca_analyse
from libraries.Utilities import set_app_icon

BRAND = (79 / 255, 190 / 255, 159 / 255)


class TEMDenoisePlotsWindow(wx.Frame):
    """Explained-variance and loadings plots for one PCA fit."""

    def __init__(self, parent, image, mode, axis=0, patch=8, stride=4,
                 title_suffix=''):
        super().__init__(parent, title='TEM PCA — variance & loadings',
                         size=(900, 460),
                         style=wx.DEFAULT_FRAME_STYLE | wx.FRAME_FLOAT_ON_PARENT)
        set_app_icon(self)
        self.parent = parent

        panel = wx.Panel(self)
        self.fig = Figure(figsize=(9, 4.6))
        self.canvas = FigureCanvas(panel, -1, self.fig)
        sizer = wx.BoxSizer(wx.VERTICAL)
        sizer.Add(self.canvas, 1, wx.EXPAND | wx.ALL, 4)
        panel.SetSizer(sizer)
        self.CentreOnParent()

        self._draw(image, mode, axis, patch, stride, title_suffix)

    # -----------------------------------------------------------------------

    def _draw(self, image, mode, axis, patch, stride, title_suffix):
        result = pca_analyse(image, mode=mode, axis=axis, patch=patch,
                             stride=stride, max_components=12)
        ratio = result['explained_variance_ratio'] * 100.0
        loadings = result['loadings']
        feat_shape = result['feat_shape']

        self.fig.clear()
        ax_var = self.fig.add_subplot(121)
        ax_load = self.fig.add_subplot(122)

        # -- explained variance ratio --------------------------------------
        n = len(ratio)
        ax_var.bar(np.arange(1, n + 1), ratio, color=BRAND,
                   edgecolor='#2f7d68', linewidth=0.6)
        for i, v in enumerate(ratio):
            if i < 6 or v >= 1.0:
                ax_var.annotate(f'{v:.1f}%', (i + 1, v), ha='center',
                                va='bottom', fontsize=7)
        ax_var.set_xlabel('Principal component')
        ax_var.set_ylabel('Variance explained (%)')
        ax_var.set_title('Explained Variance Ratio')
        ax_var.set_xticks(np.arange(1, n + 1))
        ax_var.margins(y=0.15)

        # -- loadings ------------------------------------------------------
        if feat_shape is None:
            self._draw_line_loadings(ax_load, loadings, ratio, axis)
        else:
            self._draw_patch_loadings(ax_load, loadings, ratio, feat_shape)

        # The mode/region caption lives in the title bar, not on the figure,
        # so the plots get the full height of the window.
        mode_txt = 'Line-wise PCA' if feat_shape is None else 'Patch-based PCA'
        if title_suffix:
            mode_txt += f' — {title_suffix}'
        self.SetTitle(f'TEM PCA — {mode_txt}')
        self.fig.tight_layout()
        self.canvas.draw()

    def _draw_line_loadings(self, ax, loadings, ratio, axis):
        """Each component as a curve over the pixels along a line."""
        m = min(6, loadings.shape[0])
        x = np.arange(loadings.shape[1])
        for i in range(m):
            ax.plot(x, loadings[i], linewidth=0.9,
                    label=f'PC {i + 1} ({ratio[i]:.1f}%)')
        ax.axhline(0.0, color='0.6', linewidth=0.6)
        ax.set_xlabel('Pixel along %s' % ('a row' if axis == 0 else 'a column'))
        ax.set_ylabel('Loading')
        ax.set_title('Principal Components (Loadings)')
        ax.legend(fontsize=7, ncol=1, loc='best')

    def _draw_patch_loadings(self, ax, loadings, ratio, feat_shape):
        """First components as a montage of patch-sized eigen-tiles."""
        p = feat_shape[0]
        m = min(9, loadings.shape[0])
        ncol = int(np.ceil(np.sqrt(m)))
        nrow = int(np.ceil(m / ncol))
        gap = 1
        H = nrow * (p + gap) - gap
        W = ncol * (p + gap) - gap
        tile = np.full((H, W), np.nan)
        for i in range(m):
            r, c = divmod(i, ncol)
            y0, x0 = r * (p + gap), c * (p + gap)
            tile[y0:y0 + p, x0:x0 + p] = loadings[i].reshape(p, p)
        vmax = np.nanmax(np.abs(tile)) or 1.0
        ax.imshow(tile, cmap='RdBu_r', vmin=-vmax, vmax=vmax,
                  interpolation='nearest')
        for i in range(m):
            r, c = divmod(i, ncol)
            ax.text(c * (p + gap) + p / 2.0, r * (p + gap) + 1.5,
                    f'PC{i + 1}  {ratio[i]:.1f}%', ha='center', va='top',
                    fontsize=7, color='black',
                    bbox=dict(boxstyle='round,pad=0.1', fc='white', ec='none',
                              alpha=0.7))
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_title('Principal Components (Loadings)')
