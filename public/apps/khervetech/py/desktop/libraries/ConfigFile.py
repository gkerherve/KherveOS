# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/ConfigFile.py. Regenerate with tools/export_khervetech.py.


def Init_Measurement_Data(window):
    Data = {
        'FilePath': '',
        'Number of Core levels': 0,
        'Core levels': {},
    }

    # Initialize 10 Results Tables
    for i in range(10):
        Data[f'Results Table{i}'] = {
            'Peak': {}
        }

    return Data

