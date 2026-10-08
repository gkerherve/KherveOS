# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/Save.py. Regenerate with tools/export_khervetech.py.
import json
import numpy as np
import wx
import wx.grid


def _round_keep_small(value, decimal_places):
    """round(value, decimal_places), except that a number below 1 keeps five
    significant figures instead of being rounded to 0.00 - small peak areas,
    their uncertainties, normalised intensities."""
    value = float(value)
    a = abs(value)
    if a == 0 or a >= 1 or not np.isfinite(value):
        return round(value, decimal_places) if np.isfinite(value) else value
    return round(value, max(decimal_places, 4 - int(np.floor(np.log10(a)))))


def convert_to_serializable_and_round(obj, window=None, decimal_places=2):
    try:
        if isinstance(obj, (float, np.float32, np.float64)):
            return _round_keep_small(obj, decimal_places)
        elif isinstance(obj, (int, np.int32, np.int64)):
            return int(obj)
        elif isinstance(obj, np.ndarray):
            # Check if array is empty
            if obj.size == 0:
                return []
            return [convert_to_serializable_and_round(item, window, decimal_places) for item in obj.tolist()]
        elif isinstance(obj, list):
            return [convert_to_serializable_and_round(item, window, decimal_places) for item in obj]
        elif isinstance(obj, dict):
            return {k: convert_to_serializable_and_round(v, window, decimal_places) for k, v in obj.items()}
        elif isinstance(obj, wx.grid.Grid):
            if window and obj == window.results_grid:
                # Your existing results_grid handling code
                return {
                    "rows": obj.GetNumberRows(),
                    "cols": obj.GetNumberCols(),
                    "data": [{
                        # Rest of your code
                    } for row in range(obj.GetNumberRows())]
                }
            else:
                return {
                    "rows": obj.GetNumberRows(),
                    "cols": obj.GetNumberCols(),
                    "data": [[convert_to_serializable_and_round(obj.GetCellValue(row, col), window, decimal_places)
                              for col in range(obj.GetNumberCols())]
                             for row in range(obj.GetNumberRows())]
                }
        elif hasattr(obj, 'tolist'):
            try:
                return convert_to_serializable_and_round(obj.tolist(), window, decimal_places)
            except Exception as e:
                print(f"Error converting with tolist: {e}")
                return str(obj)
        else:
            return obj
    except Exception as e:
        print(f"Error in convert_to_serializable_and_round: {e}, type: {type(obj)}")
        return str(obj)



def save_state(window):
    window.save_state()


def update_undo_redo_state(window):
    pass
