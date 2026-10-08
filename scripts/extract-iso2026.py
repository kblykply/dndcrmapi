"""Extract the supplied licensed PDF into the private ISO 2026 source catalogue.

Run with PyMuPDF installed in a tooling environment, not an application dependency.
Text spans are ordered by their baseline to preserve mixed-font paragraph order.
The original PDF remains the authority; only running headers/footers and whitespace
are removed. English requirement wording is never generated or translated.
"""
import hashlib
import json
from collections import Counter
from pathlib import Path
import re
import sys

import pymupdf

SOURCE = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "src/iso-2026/iso-2026-source.json"

TRANSLATIONS = {
    "Foreword": "Önsöz", "Introduction": "Giriş", "General": "Genel",
    "Scope": "Kapsam", "Normative references": "Normatif atıflar",
    "Terms and definitions": "Terimler ve tanımlar",
    "Quality management principles": "Kalite yönetim ilkeleri",
    "Process approach": "Süreç yaklaşımı", "Plan-Do-Check-Act cycle": "Planla–Uygula–Kontrol Et–Önlem Al döngüsü",
    "Relationship with other management system standards": "Diğer yönetim sistemi standartlarıyla ilişki",
    "Context of the organization": "Kuruluşun bağlamı",
    "Understanding the organization and its context": "Kuruluşun ve bağlamının anlaşılması",
    "Understanding the needs and expectations of interested parties": "İlgili tarafların ihtiyaç ve beklentileri",
    "Determining the scope of the quality management system": "Kalite yönetim sisteminin kapsamı",
    "Quality management system": "Kalite yönetim sistemi", "Leadership": "Liderlik",
    "Leadership and commitment": "Liderlik ve taahhüt", "Customer focus": "Müşteri odaklılık",
    "Quality policy": "Kalite politikası", "Roles, responsibilities and authorities": "Roller, sorumluluklar ve yetkiler",
    "Planning": "Planlama", "Actions to address risks and opportunities": "Risk ve fırsatlara yönelik faaliyetler",
    "Determining risks and opportunities": "Risk ve fırsatların belirlenmesi",
    "Actions to address risks": "Risklere yönelik faaliyetler", "Actions to address opportunities": "Fırsatlara yönelik faaliyetler",
    "Quality objectives and planning to achieve them": "Kalite hedefleri ve bunlara ulaşmak için planlama",
    "Planning of changes": "Değişikliklerin planlanması", "Support": "Destek", "Resources": "Kaynaklar",
    "People": "Kişiler", "Infrastructure": "Altyapı",
    "Environment for the operation of processes": "Süreçlerin işletimi için ortam",
    "Monitoring and measuring resources": "İzleme ve ölçme kaynakları",
    "Traceability of measurement results": "Ölçüm sonuçlarının izlenebilirliği",
    "Organizational knowledge": "Kurumsal bilgi", "Competence": "Yetkinlik", "Awareness": "Farkındalık",
    "Communication": "İletişim", "Documented information": "Dokümante edilmiş bilgi",
    "Creating and updating documented information": "Dokümante edilmiş bilginin oluşturulması ve güncellenmesi",
    "Control of documented information": "Dokümante edilmiş bilginin kontrolü", "Operation": "Operasyon",
    "Operational planning and control": "Operasyonel planlama ve kontrol",
    "Requirements for products and services": "Ürün ve hizmet şartları",
    "Customer communication": "Müşteriyle iletişim",
    "Determining requirements for products and services": "Ürün ve hizmet şartlarının belirlenmesi",
    "Review of requirements for products and services": "Ürün ve hizmet şartlarının gözden geçirilmesi",
    "Changes to requirements for products and services": "Ürün ve hizmet şartlarındaki değişiklikler",
    "Design and development of products and services": "Ürün ve hizmetlerin tasarımı ve geliştirilmesi",
    "Design and development planning": "Tasarım ve geliştirmenin planlanması",
    "Design and development inputs": "Tasarım ve geliştirme girdileri",
    "Design and development controls": "Tasarım ve geliştirme kontrolleri",
    "Design and development outputs": "Tasarım ve geliştirme çıktıları",
    "Design and development changes": "Tasarım ve geliştirme değişiklikleri",
    "Control of externally provided processes, products and services": "Dışarıdan sağlanan süreç, ürün ve hizmetlerin kontrolü",
    "Type and extent of control": "Kontrolün türü ve kapsamı",
    "Information for external providers": "Dış tedarikçiler için bilgi",
    "Production and service provision": "Üretim ve hizmet sunumu",
    "Control of production and service provision": "Üretim ve hizmet sunumunun kontrolü",
    "Identification and traceability": "Tanımlama ve izlenebilirlik",
    "Property belonging to customers or external providers": "Müşterilere veya dış tedarikçilere ait mülkiyet",
    "Preservation": "Muhafaza", "Post-delivery activities": "Teslimat sonrası faaliyetler",
    "Control of changes": "Değişikliklerin kontrolü", "Release of products and services": "Ürün ve hizmetlerin serbest bırakılması",
    "Control of nonconforming outputs": "Uygun olmayan çıktıların kontrolü",
    "Performance evaluation": "Performans değerlendirme",
    "Monitoring, measurement, analysis and evaluation": "İzleme, ölçme, analiz ve değerlendirme",
    "Customer satisfaction": "Müşteri memnuniyeti", "Analysis and evaluation": "Analiz ve değerlendirme",
    "Internal audit": "İç tetkik", "Internal audit programme": "İç tetkik programı",
    "Management review": "Yönetimin gözden geçirmesi", "Management review inputs": "Yönetimin gözden geçirmesi girdileri",
    "Management review results": "Yönetimin gözden geçirmesi sonuçları", "Improvement": "İyileştirme",
    "Continual improvement": "Sürekli iyileştirme", "Nonconformity and corrective action": "Uygunsuzluk ve düzeltici faaliyet",
    "Clarification of structure, terminology and clauses": "Yapı, terminoloji ve maddelere ilişkin açıklamalar",
    "Structure and terminology": "Yapı ve terminoloji", "Applicability": "Uygulanabilirlik", "Bibliography": "Kaynakça",
    "organization": "kuruluş", "interested party": "ilgili taraf", "top management": "üst yönetim",
    "management system": "yönetim sistemi", "quality management system": "kalite yönetim sistemi",
    "policy": "politika", "quality policy": "kalite politikası", "objective": "hedef", "quality objective": "kalite hedefi",
    "monitoring": "izleme", "measurement": "ölçme", "risk": "risk", "process": "süreç", "competence": "yetkinlik", "documented information": "dokümante edilmiş bilgi",
    "performance": "performans", "continual improvement": "sürekli iyileştirme", "effectiveness": "etkinlik",
    "requirement": "şart", "conformity": "uygunluk", "nonconformity": "uygunsuzluk",
    "corrective action": "düzeltici faaliyet", "audit": "tetkik",
}


def norm(text):
    return re.sub(r"\s+", " ", text.replace("\ufeff", "")).strip()


def page_lines(page, page_no):
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                # Running header, personal licence watermark and page footer.
                if 59 < span["origin"][1] < 789 and norm(span["text"]):
                    spans.append(span)
    groups = []
    for span in sorted(spans, key=lambda value: value["origin"][1]):
        y = span["origin"][1]
        if not groups or y - groups[-1]["y"] > 3.5:
            groups.append({"y": y, "spans": [span]})
        else:
            groups[-1]["spans"].append(span)
    result = []
    for group in groups:
        ordered = sorted(group["spans"], key=lambda value: value["origin"][0])
        text = ""
        prev = None
        for span in ordered:
            if prev and span["origin"][0] - prev["bbox"][2] > 1.7 and not text.endswith((" ", "\t")):
                text += " "
            text += span["text"]
            prev = span
        result.append({"text": norm(text), "page": page_no, "y": group["y"], "spans": ordered})
    return result


pdf = pymupdf.open(SOURCE)
assert len(pdf) == 48, "Unexpected source PDF; review extraction before using another edition."
lines = []
for index in range(4, 46):
    lines.extend(page_lines(pdf[index], index + 1))

clauses = []
current = None
last_line = None
skip = 0


def start(code, title, line, editorial=False):
    global current, last_line
    parent = code.rsplit(".", 1)[0] if "." in code else None
    kind = "annex" if code.startswith("A") else "introduction" if code.startswith("0") else "front-matter" if code == "foreword" else "bibliography" if code == "bibliography" else "term" if code.startswith("3.") else "clause"
    current = {"code": code, "title": title, "titleTr": TRANSLATIONS.get(title, title), "parentCode": parent, "kind": kind, "body": "", "sourcePages": [line["page"]], "relatedCodes": [], "titleIsEditorial": editorial}
    clauses.append(current)
    last_line = line


def append(text, line):
    global last_line
    if not current or not text:
        return
    gap = line["y"] - last_line["y"] if last_line and line["page"] == last_line["page"] else 0
    is_new = bool(re.match(r"^(?:[a-z]\)|\d+\)|—|NOTE\b|Note \d+|EXAMPLE\b|Figure \d+|Table \w|\[\d+\])", text))
    sep = "\n\n" if current["body"] and (gap > 16 or is_new) else " " if current["body"] else ""
    current["body"] += sep + text
    if line["page"] not in current["sourcePages"]:
        current["sourcePages"].append(line["page"])
    last_line = line


for index, line in enumerate(lines):
    if skip:
        skip -= 1
        continue
    text = line["text"]
    if text == "Foreword":
        start("foreword", "Foreword", line)
        continue
    if text == "Introduction":
        start("0", "Introduction", line)
        continue
    if text == "Annex A":
        start("A", "Clarification of structure, terminology and clauses", line)
        skip = 2  # informative label and title; retained as metadata, not a requirement
        continue
    if text == "Bibliography":
        start("bibliography", "Bibliography", line)
        continue
    if text == "Quality management systems — Requirements" and line["page"] == 11:
        continue
    match = re.match(r"^(\d{1,2}(?:\.\d+){0,3}|A(?:\.\d+){1,3})(?:\s+(.+))?$", text)
    if match and line["spans"][0]["origin"][0] < 49:
        code, rest = match.groups()
        if not rest and code.startswith("3."):
            title = lines[index + 1]["text"]
            start(code, title, line)
            skip = 1
        elif rest:
            # Numbered paragraphs without a source heading retain every sentence in body.
            sentence = bool(re.match(r"^(?:The organization|Top management|Documented information (?:shall|required)|When |For the control|The quality policy)", rest))
            if sentence:
                parent_code = code.rsplit(".", 1)[0]
                title = next(c["title"] for c in reversed(clauses) if c["code"] == parent_code)
                start(code, title, line, editorial=True)
                append(rest, line)
            else:
                start(code, rest, line)
        else:
            append(text, line)
    else:
        append(text, line)

by_code = {clause["code"]: clause for clause in clauses}
assert len(by_code) == len(clauses), [(c["code"], c["title"], c["sourcePages"]) for c in clauses if sum(x["code"] == c["code"] for x in clauses) > 1]
for clause in reversed(clauses):
    parent = clause["parentCode"]
    if parent:
        assert parent in by_code, f"Missing parent {parent}"
        by_code[parent]["sourcePages"] = sorted(set(by_code[parent]["sourcePages"] + clause["sourcePages"]))
    refs = re.findall(r"\b(?:A\.)?\d{1,2}(?:\.\d+){1,3}\b", clause["body"])
    related = list(dict.fromkeys(code for code in refs if code in by_code and code != clause["code"]))
    partner = clause["code"][2:] if clause["code"].startswith("A.") else "A." + clause["code"]
    if partner in by_code and partner not in related:
        related.insert(0, partner)
    clause["relatedCodes"] = related

# Ensure the 2026 structure, and several mixed-font passages previously reordered by PDFKit.
for code in ["0.3.1", "0.3.2", "3.5", "4", "4.4.1", "5.2.1", "6.1.1", "6.1.2", "6.1.3", "7.5.3.1", "8.7.2", "9.1.2", "10.1", "10.2", "A.10.2", "bibliography"]:
    assert code in by_code, f"Missing required clause {code}"
assert by_code["7.5.3.1"]["body"].startswith("Documented information required by the quality management system and by this document shall be controlled to ensure:")
assert "intentions and direction of an organization" in by_code["3.5"]["body"]
assert by_code["10.1"]["title"] == "Continual improvement"

# Reconcile every extracted source token with the per-clause output. Editorial
# titles are excluded and the original unnumbered headings are reconstructed.
expected_text = " ".join(line["text"] for line in lines if not (line["page"] == 11 and line["text"] == "Quality management systems — Requirements"))
reconstructed = []
for clause in clauses:
    code, title = clause["code"], clause["title"]
    if code == "A":
        reconstructed.append("Annex A (informative) " + title)
    elif code in ("foreword", "0", "bibliography"):
        reconstructed.append(title)
    elif clause["titleIsEditorial"]:
        reconstructed.append(code)
    else:
        reconstructed.append(code + " " + title)
    reconstructed.append(clause["body"])
source_tokens = Counter(re.findall(r"\S+", expected_text))
output_tokens = Counter(re.findall(r"\S+", " ".join(reconstructed)))
assert source_tokens == output_tokens, "Source words lost or added during clause extraction"

document = {
    "title": "Quality management systems — Requirements",
    "reference": "ISO 9001:2026(en)",
    "status": "Sixth edition · 2026-09",
    "language": "en",
    "sourceFile": SOURCE.name,
    "totalPages": len(pdf),
    "sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
}
TARGET.parent.mkdir(parents=True, exist_ok=True)
TARGET.write_text(json.dumps({"document": document, "clauses": clauses}, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"clauses": len(clauses), "bodyCharacters": sum(len(c["body"]) for c in clauses), "editorialHeadings": [c["code"] for c in clauses if c["titleIsEditorial"]], "untranslatedTitles": sorted(set(c["title"] for c in clauses if c["title"] == c["titleTr"] and c["title"] != "risk")), "output": str(TARGET)}, ensure_ascii=False, indent=2))
