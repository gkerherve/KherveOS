# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/PlotLabelEdit.py. Regenerate with tools/export_khervetech.py.


def legend_frame_kwargs(window):
    """ax.legend() frame keywords from Preferences > Text (Legend Frame,
    Rounded Corners, Frame Colour, Background); the defaults are the look
    the plots always had."""
    return dict(frameon=bool(getattr(window, 'legend_frame', True)),
                fancybox=bool(getattr(window, 'legend_rounded', True)),
                framealpha=float(getattr(window, 'legend_alpha', 0.1)),
                edgecolor=getattr(window, 'legend_edge', 'gray'))

