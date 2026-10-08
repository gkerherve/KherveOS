# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/Widgets_Toolbars.py. Regenerate with tools/export_khervetech.py.


def open_tougaard_analysis_window(parent_window):
    """Open the Tougaard Quantitative XPS Depth Analysis window"""
    from libraries.ToolsMenu.TougaardAnalysisWindow import TougaardAnalysisWindow
    tougaard_window = TougaardAnalysisWindow(parent_window)
    tougaard_window.Show()


def open_ftir_analysis_window(window):
    """Open (or raise) the FTIR Analysis window"""
    from libraries.ToolsMenu.FTIR_Analysis import open_ftir_window
    open_ftir_window(window)


def open_squid_analysis_window(window):
    """Open (or raise) the SQUID Analysis window"""
    from libraries.ToolsMenu.SQUID_Analysis import open_squid_window
    open_squid_window(window)


def open_tga_analysis_window(window):
    """Open (or raise) the TGA / DSC Analysis window"""
    from libraries.ToolsMenu.TGA_Analysis import open_tga_window
    open_tga_window(window)


def open_eis_analysis_window(window):
    """Open (or raise) the EIS Analysis window"""
    from libraries.ToolsMenu.EIS_Analysis import open_eis_window
    open_eis_window(window)


def open_sem_analysis_window(window):
    """Open (or raise) the SEM Image Analysis window"""
    from libraries.ToolsMenu.SEM_Analysis import open_sem_window
    open_sem_window(window)


def open_tem_analysis_window(window):
    """Open (or raise) the TEM Analysis window"""
    from libraries.ToolsMenu.TEM_Analysis import open_tem_window
    open_tem_window(window)


def open_afm_analysis_window(window):
    """Open (or raise) the AFM Analysis window"""
    from libraries.ToolsMenu.AFM_Analysis import open_afm_window
    open_afm_window(window)


def open_xrd_analysis_window(window):
    """Open (or raise) the XRD Analysis window"""
    from libraries.ToolsMenu.XRD_Analysis import open_xrd_window
    open_xrd_window(window)


def open_uvvis_analysis_window(window):
    """Open (or raise) the UV-Vis Analysis window"""
    from libraries.ToolsMenu.UVVIS_Analysis import open_uvvis_window
    open_uvvis_window(window)


def open_pl_analysis_window(window):
    """Open (or raise) the Photoluminescence Analysis window"""
    from libraries.ToolsMenu.PL_Analysis import open_pl_window
    open_pl_window(window)


def open_ellips_analysis_window(window):
    """Open (or raise) the Ellipsometry Analysis window"""
    from libraries.ToolsMenu.Ellips_Analysis import open_ellips_window
    open_ellips_window(window)


def open_raman_analysis_window(window):
    """Open (or raise) the Raman Analysis window"""
    from libraries.ToolsMenu.Raman_Analysis import open_raman_window
    open_raman_window(window)


def open_ms_analysis_window(window):
    """Open (or raise) the Mass Spectrometry Analysis window"""
    from libraries.ToolsMenu.MS_Analysis import open_ms_window
    open_ms_window(window)


def open_gc_analysis_window(window):
    """Open (or raise) the Gas Chromatography Analysis window"""
    from libraries.ToolsMenu.GC_Analysis import open_gc_window
    open_gc_window(window)


def open_dil_analysis_window(window):
    """Open (or raise) the Dilatometry Analysis window"""
    from libraries.ToolsMenu.DIL_Analysis import open_dil_window
    open_dil_window(window)


def open_bet_analysis_window(window):
    """Open (or raise) the BET / Physisorption Analysis window"""
    from libraries.ToolsMenu.BET_Analysis import open_bet_window
    open_bet_window(window)

