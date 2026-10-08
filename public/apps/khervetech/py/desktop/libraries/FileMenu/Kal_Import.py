# KherveOS: these definitions cut unchanged from KherveFittingPro origin/dev-AI (ca1fe50), libraries/FileMenu/Kal_Import.py. Regenerate with tools/export_khervetech.py.
import os
import wx


def import_raman_txt_file(window):
    import wx
    import os
    import openpyxl
    from libraries.FileMenu.Open import open_xlsx_file

    with wx.FileDialog(window, "Open Raman text file", wildcard="Text files (*.txt)|*.txt",
                       style=wx.FD_OPEN | wx.FD_FILE_MUST_EXIST) as fileDialog:
        if fileDialog.ShowModal() == wx.ID_CANCEL:
            return
        file_path = fileDialog.GetPath()

    try:
        # Get filename without extension for sheet name
        base_filename = os.path.basename(file_path).split('.')[0]
        sheet_name = f"Raman_{base_filename}"

        # Read data from txt file
        data = []
        with open(file_path, 'r') as f:
            for line in f:
                if line.strip() and not line.startswith('#'):
                    parts = line.strip().split()
                    if len(parts) >= 2:
                        try:
                            wavenumber = float(parts[0])
                            intensity = float(parts[1])
                            data.append([wavenumber, intensity])
                        except ValueError:
                            continue

        if not data:
            window.show_popup_message2("Error", "No valid data found in the file.")
            return

        # Create new Excel file if needed
        output_dir = os.path.dirname(file_path)
        excel_path = os.path.join(output_dir, f"{base_filename}.xlsx")

        if os.path.exists(excel_path):
            # If Excel file exists, load it
            wb = openpyxl.load_workbook(excel_path)
        else:
            # Create new Excel file
            wb = openpyxl.Workbook()
            # Remove default sheet
            if "Sheet" in wb.sheetnames:
                wb.remove(wb["Sheet"])

        # Create or replace the sheet
        if sheet_name in wb.sheetnames:
            wb.remove(wb[sheet_name])
        ws = wb.create_sheet(sheet_name)

        # Add headers
        ws["A1"] = "Wavenumber (cm-1)"
        ws["B1"] = "Raw Data"

        # Add data
        for i, (wavenumber, intensity) in enumerate(data, start=2):
            ws[f"A{i}"] = wavenumber
            ws[f"B{i}"] = intensity

        # Save Excel file
        wb.save(excel_path)

        # Open the Excel file in Khervefitting
        open_xlsx_file(window, excel_path)

    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing file: {str(e)}")


def import_multiple_raman_files(window):
    import wx
    import os
    import openpyxl
    from libraries.FileMenu.Open import open_xlsx_file

    with wx.DirDialog(window, "Choose a directory containing Raman text files",
                      style=wx.DD_DEFAULT_STYLE | wx.DD_DIR_MUST_EXIST) as dirDialog:
        if dirDialog.ShowModal() == wx.ID_CANCEL:
            return
        dir_path = dirDialog.GetPath()

    try:
        # Find all txt files in the directory
        txt_files = [f for f in os.listdir(dir_path) if f.lower().endswith('.txt')]

        if not txt_files:
            window.show_popup_message2("Information", "No .txt files found in the selected folder.")
            return

        # Create an Excel file for each group of files
        excel_path = os.path.join(dir_path, "Raman_Data.xlsx")
        wb = openpyxl.Workbook()

        # Remove default sheet
        if "Sheet" in wb.sheetnames:
            wb.remove(wb["Sheet"])

        # Process each txt file
        for txt_file in txt_files:
            file_path = os.path.join(dir_path, txt_file)
            base_filename = os.path.splitext(txt_file)[0]
            sheet_name = f"Raman_{base_filename}"

            # Ensure sheet name is valid (max 31 chars)
            if len(sheet_name) > 31:
                sheet_name = sheet_name[:31]

            # Handle duplicate sheet names
            count = 1
            original_name = sheet_name
            while sheet_name in wb.sheetnames:
                sheet_name = f"{original_name[:27]}_{count}"
                count += 1

            # Read data from txt file
            data = []
            with open(file_path, 'r') as f:
                for line in f:
                    if line.strip() and not line.startswith('#'):
                        parts = line.strip().split()
                        if len(parts) >= 2:
                            try:
                                wavenumber = float(parts[0])
                                intensity = float(parts[1])
                                data.append([wavenumber, intensity])
                            except ValueError:
                                continue

            if not data:
                continue  # Skip files with no valid data

            # Create sheet
            ws = wb.create_sheet(sheet_name)

            # Add headers
            ws["A1"] = "Wavenumber (cm-1)"
            ws["B1"] = "Raw Data"

            # Add data
            for i, (wavenumber, intensity) in enumerate(data, start=2):
                ws[f"A{i}"] = wavenumber
                ws[f"B{i}"] = intensity

        # Save Excel file if sheets were created
        if len(wb.sheetnames) > 0:
            wb.save(excel_path)
            open_xlsx_file(window, excel_path)
            window.show_popup_message2("Success", f"Created Excel file with {len(wb.sheetnames)} Raman data sheets.")
        else:
            window.show_popup_message2("Information", "No valid data found in any of the text files.")

    except Exception as e:
        import traceback
        traceback.print_exc()
        window.show_popup_message2("Error", f"Error processing files: {str(e)}")

