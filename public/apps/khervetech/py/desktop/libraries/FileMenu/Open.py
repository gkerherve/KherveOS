# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/Open.py. Regenerate with tools/export_khervetech.py.
import os
import re
import json
import wx


def convert_from_serializable(obj):
    """
    Recursively converts a serializable object (list or dict) back into its original structure.
    This is used to restore complex data structures that were serialized to JSON.
    """
    if isinstance(obj, list):
        return [convert_from_serializable(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: convert_from_serializable(v) for k, v in obj.items()}
    else:
        return obj


def normalize_sheet_name(name):
    """Normalize core level name to standard format."""
    import re
    new_name = name

    lower_name = name.lower()
    if 'xps survey' in lower_name:
        new_name = 'Survey'
    elif 'survey' in lower_name:
        new_name = 'Survey'
    elif 'survey scan' in lower_name:
        new_name = 'Survey'
    elif 'wide' in lower_name:
        new_name = 'Wide'
    elif 'wide scan' in lower_name:
        new_name = 'Wide'
    elif 'su1s' in lower_name or '_su' in lower_name or name.lower().endswith('_su'):
        new_name = 'Survey'
    elif any(term in lower_name for term in ['valence', 'valence band', 'valence scan', 'vb scan', 'vb', 'valence band scan']):
        new_name = 'VB'
    elif any(term in lower_name for term in ['fermi', 'fermi scan']):
        new_name = 'Fermi'
    else:
        # Remove spaces between element and orbital (e.g., "C 1s" → "C1s")
        match = re.search(r'([A-Z][a-z]?)\s+(\d+[spdf])', name)
        if match:
            element, orbital = match.groups()
            new_name = f"{element}{orbital}"

        # Simplify names like "C1s Scan" to just "C1s"
        match = re.search(r'([A-Z][a-z]?\d+[spdf])', new_name)
        if match and len(new_name) > len(match.group(1)):
            new_name = match.group(1)

    # Preserve sample number suffix if it exists
    suffix_match = re.search(r'(\d+)$', name)
    if suffix_match and not re.search(r'\d+$', new_name):
        new_name = f"{new_name}{suffix_match.group(1)}"

    return new_name



def open_xlsx_file(window, file_path=None):
    from ktech.project import open_xlsx_file as _open
    return _open(window, file_path)


def import_raman_txt_file(window):
    from libraries.FileMenu.Kal_Import import import_raman_txt_file as _f
    return _f(window)


def import_multiple_raman_files(window):
    from libraries.FileMenu.Kal_Import import import_multiple_raman_files as _f
    return _f(window)
