"""Read workbook values/styles without executing formulas. Pipe output privately.

Output contains matching identities and must stay in the research process memory;
the TypeScript caller persists only anonymized findings.
"""
import datetime
import json
import xml.etree.ElementTree as ET
from zipfile import ZipFile

WORKBOOK = "/Users/kubilaykuplay/Downloads/TAHSİLAT VE BORÇ RAPORLARI.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
samples = []
with ZipFile(WORKBOOK) as archive:
    strings = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    styles = ET.fromstring(archive.read("xl/styles.xml")).find("m:cellXfs", NS)
    for sheet, number, unit_col, name_col, due_col, amount_col in [
        ("HAZİRAN", 3, "B", "C", "D", "E"),
        ("AĞUSTOS", 5, "A", "B", "C", "D"),
        ("EYLÜL", 6, "A", "B", "C", "D"),
    ]:
        root = ET.fromstring(archive.read(f"xl/worksheets/sheet{number}.xml"))
        controls = 0
        for row in root.findall("m:sheetData/m:row", NS):
            if int(row.attrib["r"]) < 5:
                continue
            values, fills = {}, {}
            for cell in row:
                column = "".join(c for c in cell.attrib["r"] if c.isalpha())
                value = cell.find("m:v", NS)
                value = None if value is None else value.text
                if cell.attrib.get("t") == "s" and value is not None:
                    value = strings[int(value)]
                values[column] = value
                fills[column] = int(styles[int(cell.attrib.get("s", "0"))].attrib.get("fillId", "0"))
            try:
                amount = float(values[amount_col])
                due = (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(values[due_col]))).date().isoformat()
            except (KeyError, TypeError, ValueError):
                continue
            if amount <= 0 or not values.get(unit_col) or not values.get(name_col):
                continue
            marked = fills.get(amount_col) in (5, 7)
            if not marked:
                if controls >= 2 or amount < 750:
                    continue
                controls += 1
            samples.append({
                "id": len(samples) + 1, "sheet": sheet, "row": int(row.attrib["r"]),
                "marked": marked, "unit": values[unit_col].strip(),
                "customer": values[name_col].strip(), "due": due, "outstanding": amount,
            })
print(json.dumps(samples, ensure_ascii=False))
