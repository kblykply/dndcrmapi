const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const INPUT = path.join(__dirname, "old-customers.xlsx");
const OUTPUT_XLSX = path.join(__dirname, "old-customers-normalized.xlsx");
const OUTPUT_CUSTOMERS_CSV = path.join(__dirname, "old-customers-customers.csv");
const OUTPUT_UNITS_CSV = path.join(__dirname, "old-customers-units.csv");
const OUTPUT_ISSUES_CSV = path.join(__dirname, "old-customers-issues.csv");
const OUTPUT_ONE_TABLE_XLSX = path.join(__dirname, "old-customers-one-table.xlsx");
const OUTPUT_ONE_TABLE_CSV = path.join(__dirname, "old-customers-one-table.csv");
const WRITE_RELATIONAL_OUTPUTS = process.argv.includes("--relational");

const PROJECTS = {
  LJ: "LA_JOYA",
  LJP: "LA_JOYA_PERLA",
  LJP2: "LA_JOYA_PERLA_II",
  LV: "LAGOON_VERDE",
};

const PROJECT_LABELS = {
  LA_JOYA: "La Joya",
  LA_JOYA_PERLA: "La Joya Perla",
  LA_JOYA_PERLA_II: "La Joya Perla II",
  LAGOON_VERDE: "Lagoon Verde",
};

const SALES_REPRESENTATIVES = {
  BOB: { name: "Bob Parpiev", email: "bob.parpiev@dndcyprus.com", role: "SALES" },
  OKAN: { name: "Okan Afsar", email: "okan.afsar@dndcyprus.com", role: "SALES" },
  ONUR: { name: "Onur Pekkaya", email: "onur.pekkaya@dndcyprus.com", role: "SALES" },
  SABINA: { name: "Sabina Rahimova", email: "sabina.rahimova@dnd-homes.com", role: "SALES" },
  SHADI: { name: "Shadi Maghfoori", email: "shadi.maghfoori@dndcyprus.com", role: "SALES" },
  SHAYAN: { name: "Shayan Karimi", email: "shayan.karimi@dndcyprus.com", role: "SALES" },
  BORHAN: { name: "Borhan Ghasemzadeh", email: "borhan.ghasemzadeh@dndcyprus.com", role: "ADMIN" },
  OZAN: { name: "Ozan Dokmecioglu", email: "ozan.dokmecioglu@dnd-homes.com", role: "ADMIN" },
};

function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function upper(value) {
  return clean(value)
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .toUpperCase();
}

function normalizeOldCode(value) {
  return clean(value)
    .replace(/\s*-\s*/g, "-")
    .replace(/^([A-Za-zİıÇĞÖŞÜçğöşü]{2})\s+/, "$1-");
}

function parseOldCode(value) {
  const oldCode = normalizeOldCode(value);
  const normalized = upper(oldCode);
  const match = normalized.match(/^([A-Z]{2,5})[- ]?(.+)$/);

  if (!match) {
    return {
      oldCode,
      nationalityCode: "",
      identityNumber: "",
      baseIdentityNumber: "",
      customerKey: oldCode,
      parseIssue: oldCode ? "Could not parse nationality / identity number" : "Missing old code",
    };
  }

  const nationalityCode = match[1];
  const identityNumber = match[2].replace(/^-+/, "").trim();
  const baseIdentityNumber = identityNumber.replace(/-\d+$/, "");

  return {
    oldCode,
    nationalityCode,
    identityNumber,
    baseIdentityNumber,
    customerKey: `${nationalityCode}-${baseIdentityNumber}`,
    parseIssue: identityNumber ? "" : "Missing identity number",
  };
}

function inferProject(rawProjectCode, rawUnitCode, rawUnitName) {
  const projectCode = upper(rawProjectCode);
  if (PROJECTS[projectCode]) return PROJECTS[projectCode];

  const unitCode = upper(rawUnitCode);
  const unitPrefix = unitCode.split("-")[0];
  if (PROJECTS[unitPrefix]) return PROJECTS[unitPrefix];

  const unitName = upper(rawUnitName);
  if (unitName.includes("LAGOON") || unitName.includes("LAGON")) return "LAGOON_VERDE";
  if (unitName.includes("LA JOYA PERLA 2")) return "LA_JOYA_PERLA_II";
  if (unitName.includes("LA JOYA PERLA")) return "LA_JOYA_PERLA";
  if (unitName.includes("LA JOYA")) return "LA_JOYA";

  return "";
}

function parseUnitNumber(rawUnitCode, project) {
  const unitCode = clean(rawUnitCode).replace(/\s*-\s*/g, "-");
  if (!unitCode) return "";

  const projectPrefix = Object.entries(PROJECTS).find(([, crmProject]) => crmProject === project)?.[0];
  if (projectPrefix && upper(unitCode).startsWith(`${projectPrefix}-`)) {
    return unitCode.slice(projectPrefix.length + 1).trim();
  }

  return unitCode;
}

function removeUnitSuffix(rawName, rawUnitCode) {
  let name = clean(rawName);
  const unitCode = clean(rawUnitCode).replace(/\s*-\s*/g, "-");
  if (!name || !unitCode) return name;

  const escapedUnit = unitCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  name = name.replace(new RegExp(`\\s*-\\s*${escapedUnit}\\s*$`, "i"), "");

  const unitNumber = unitCode.split("-").slice(1).join("-");
  if (unitNumber) {
    const escapedUnitNumber = unitNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name.replace(new RegExp(`\\s*-\\s*${escapedUnitNumber}\\s*$`, "i"), "");
  }

  return name.replace(/\s+-\s+$/g, "").trim();
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  if (!email) return "";
  if (!email.includes("@")) return "";
  if (email.includes(" ")) return "";
  return email;
}

function normalizePhone(value) {
  return clean(value);
}

function addIssue(issues, rowNumber, oldCode, field, problem, value) {
  issues.push({
    rowNumber,
    oldCode,
    field,
    problem,
    value: clean(value),
  });
}

function toWorksheet(rows) {
  return XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
}

function writeCsv(file, rows) {
  const worksheet = toWorksheet(rows);
  fs.writeFileSync(file, XLSX.utils.sheet_to_csv(worksheet));
}

function addSetValue(target, value) {
  const cleaned = clean(value);
  if (cleaned) target.add(cleaned);
}

function addArrayValue(target, value) {
  const cleaned = clean(value);
  if (cleaned) target.push(cleaned);
}

function joinValues(values, separator = " | ") {
  return [...values].filter(Boolean).join(separator);
}

function getSalesRepresentative(salesCode) {
  return SALES_REPRESENTATIVES[upper(salesCode)] || null;
}

function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Missing input file: ${INPUT}`);
  }

  const workbook = XLSX.readFile(INPUT, { raw: false });
  const sheet = workbook.Sheets["BIG DATA"];
  if (!sheet) {
    throw new Error("Missing required sheet: BIG DATA");
  }

  const rows = XLSX.utils
    .sheet_to_json(sheet, { defval: "", raw: false })
    .filter((row) => Object.values(row).some((value) => clean(value)));

  const customersByKey = new Map();
  const unitsByKey = new Map();
  const oneTableByKey = new Map();
  const issues = [];
  const salesCodes = new Map();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const parsedCode = parseOldCode(row["CARİ KOD"] || row.KOD);
    const oldCode = parsedCode.oldCode || `ROW-${rowNumber}`;
    const rawName = clean(row["CARİ ADI"]);
    const rawEmail = clean(row.MAIL);
    const rawPhone = clean(row.TELEFON);
    const rawUnitCode = clean(row["DAİRE"]);
    const rawUnitName = clean(row["DAİRE ADI"]);
    const rawProjectCode = clean(row["PROJE KOD"]);
    const salesCode = upper(row.SE_KODU);
    const broker = clean(row.BROKER);
    const project = inferProject(rawProjectCode, rawUnitCode, rawUnitName);
    const unitNumber = parseUnitNumber(rawUnitCode, project);
    const email = normalizeEmail(rawEmail);
    const fullName = removeUnitSuffix(rawName, rawUnitCode);

    if (parsedCode.parseIssue) {
      addIssue(issues, rowNumber, oldCode, "CARİ KOD", parsedCode.parseIssue, row["CARİ KOD"]);
    }
    if (!fullName) {
      addIssue(issues, rowNumber, oldCode, "CARİ ADI", "Missing customer name", rawName);
    }
    if (rawEmail && !email) {
      addIssue(issues, rowNumber, oldCode, "MAIL", "Invalid email moved to notes", rawEmail);
    }
    if (!rawPhone) {
      addIssue(issues, rowNumber, oldCode, "TELEFON", "Missing phone", rawPhone);
    }
    if (!project) {
      addIssue(
        issues,
        rowNumber,
        oldCode,
        "PROJE KOD",
        "Project is unsupported or missing for CRM ProjectType",
        rawProjectCode || rawUnitName || rawUnitCode,
      );
    }
    if (!unitNumber) {
      addIssue(issues, rowNumber, oldCode, "DAİRE", "Missing unit number", rawUnitCode);
    }
    if (!salesCode || salesCode === "BOŞ") {
      addIssue(issues, rowNumber, oldCode, "SE_KODU", "Missing sales representative code", row.SE_KODU);
    }

    salesCodes.set(salesCode || "(blank)", (salesCodes.get(salesCode || "(blank)") || 0) + 1);

    const customerKey = parsedCode.customerKey || oldCode;
    const salesRepresentative = getSalesRepresentative(salesCode);

    if (!oneTableByKey.has(customerKey)) {
      oneTableByKey.set(customerKey, {
        customerKey,
        oldCariKodList: new Set(),
        nationalityCodes: new Set(),
        identityNumbers: new Set(),
        rawIdentityNumbers: new Set(),
        names: new Set(),
        emails: new Set(),
        rawEmails: new Set(),
        phones: new Set(),
        salesCodes: new Set(),
        salesRepresentativeNames: new Set(),
        salesRepresentativeEmails: new Set(),
        salesRepresentativeRoles: new Set(),
        brokerNames: new Set(),
        rawProjectCodes: new Set(),
        crmProjects: new Set(),
        projectNames: new Set(),
        unitNumbers: new Set(),
        propertyDetails: new Set(),
        rawUnitCodes: new Set(),
        rawUnitNames: new Set(),
        unsupportedProperties: new Set(),
        rowNumbers: [],
      });
    }

    const oneTableRow = oneTableByKey.get(customerKey);
    addSetValue(oneTableRow.oldCariKodList, oldCode);
    addSetValue(oneTableRow.nationalityCodes, parsedCode.nationalityCode);
    addSetValue(oneTableRow.identityNumbers, parsedCode.baseIdentityNumber || parsedCode.identityNumber);
    addSetValue(oneTableRow.rawIdentityNumbers, parsedCode.identityNumber);
    addSetValue(oneTableRow.names, fullName);
    addSetValue(oneTableRow.emails, email);
    if (rawEmail && !email) addSetValue(oneTableRow.rawEmails, rawEmail);
    addSetValue(oneTableRow.phones, normalizePhone(rawPhone));
    if (salesCode && salesCode !== "BOŞ") addSetValue(oneTableRow.salesCodes, salesCode);
    if (salesRepresentative) {
      addSetValue(oneTableRow.salesRepresentativeNames, salesRepresentative.name);
      addSetValue(oneTableRow.salesRepresentativeEmails, salesRepresentative.email);
      addSetValue(oneTableRow.salesRepresentativeRoles, salesRepresentative.role);
    }
    addSetValue(oneTableRow.brokerNames, broker);
    addSetValue(oneTableRow.rawProjectCodes, rawProjectCode);
    addSetValue(oneTableRow.crmProjects, project);
    addSetValue(oneTableRow.projectNames, project ? PROJECT_LABELS[project] : "");
    addSetValue(oneTableRow.unitNumbers, unitNumber);
    addSetValue(oneTableRow.rawUnitCodes, rawUnitCode);
    addSetValue(oneTableRow.rawUnitNames, rawUnitName);
    addArrayValue(oneTableRow.rowNumbers, rowNumber);

    if (project && unitNumber) {
      addSetValue(
        oneTableRow.propertyDetails,
        `${PROJECT_LABELS[project]} / ${unitNumber} (${rawUnitCode})`,
      );
    } else {
      addSetValue(
        oneTableRow.unsupportedProperties,
        [rawProjectCode, rawUnitCode, rawUnitName].filter(Boolean).join(" / "),
      );
    }

    if (!customersByKey.has(oldCode)) {
      customersByKey.set(oldCode, {
        oldCode,
        nationalityCode: parsedCode.nationalityCode,
        identityNumber: parsedCode.identityNumber,
        fullName,
        email,
        phone: normalizePhone(rawPhone),
        type: "EXISTING",
        ownerSalesCode: salesCode && salesCode !== "BOŞ" ? salesCode : "",
        ownerEmail: "",
        agencyName: broker,
        source: "Old customer import",
        language: "",
        nationality: parsedCode.nationalityCode,
        job: "",
        primaryProject: project,
        notesSummary: [
          `Old code: ${oldCode}`,
          parsedCode.nationalityCode ? `Nationality code: ${parsedCode.nationalityCode}` : "",
          parsedCode.identityNumber ? `Identity number: ${parsedCode.identityNumber}` : "",
          salesCode ? `Old sales code: ${salesCode}` : "",
          broker ? `Broker: ${broker}` : "",
          rawEmail && !email ? `Raw mail: ${rawEmail}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      });
    } else {
      const customer = customersByKey.get(oldCode);
      if (!customer.email && email) customer.email = email;
      if (!customer.phone && rawPhone) customer.phone = normalizePhone(rawPhone);
      if (!customer.agencyName && broker) customer.agencyName = broker;
      if (!customer.ownerSalesCode && salesCode && salesCode !== "BOŞ") {
        customer.ownerSalesCode = salesCode;
      }
      if (!customer.primaryProject && project) customer.primaryProject = project;
      if (fullName && customer.fullName !== fullName) {
        addIssue(
          issues,
          rowNumber,
          oldCode,
          "CARİ ADI",
          "Same old code has different customer name",
          `${customer.fullName} / ${fullName}`,
        );
      }
    }

    const unitKey = `${oldCode}__${project || "UNSUPPORTED"}__${unitNumber || rawUnitCode}`;
    if (!unitsByKey.has(unitKey)) {
      unitsByKey.set(unitKey, {
        oldCode,
        project,
        projectLabel: project ? PROJECT_LABELS[project] : "",
        unitNumber,
        rawProjectCode,
        rawUnitCode,
        rawUnitName,
        importable: project && unitNumber ? "YES" : "NO",
      });
    }
  }

  const customers = [...customersByKey.values()].sort((a, b) => a.oldCode.localeCompare(b.oldCode));
  const units = [...unitsByKey.values()].sort((a, b) =>
    `${a.oldCode} ${a.project} ${a.unitNumber}`.localeCompare(`${b.oldCode} ${b.project} ${b.unitNumber}`),
  );
  const salesCodeRows = [...salesCodes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([salesCode, rowCount]) => ({ salesCode, rowCount, ownerEmail: "", ownerName: "" }));

  const issuesByOldCode = issues.reduce((acc, issue) => {
    if (!acc.has(issue.oldCode)) acc.set(issue.oldCode, []);
    acc.get(issue.oldCode).push(`${issue.field}: ${issue.problem}${issue.value ? ` (${issue.value})` : ""}`);
    return acc;
  }, new Map());

  const oneTableRows = [...oneTableByKey.values()]
    .map((row) => {
      const oldCariKodList = [...row.oldCariKodList];
      const rowIssues = oldCariKodList.flatMap((oldCode) => issuesByOldCode.get(oldCode) || []);
      const primarySalesEmail = [...row.salesRepresentativeEmails][0] || "";

      return {
        customerKey: row.customerKey,
        originalCariKod: joinValues(oldCariKodList),
        nationalityCode: joinValues(row.nationalityCodes),
        identityNumber: joinValues(row.identityNumbers),
        rawIdentityNumbers: joinValues(row.rawIdentityNumbers),
        fullName: [...row.names][0] || "",
        alternateNames: joinValues([...row.names].slice(1)),
        email: joinValues(row.emails),
        rawInvalidEmails: joinValues(row.rawEmails),
        phone: joinValues(row.phones),
        customerType: "EXISTING",
        oldSalesCode: joinValues(row.salesCodes),
        salesRepresentativeName: joinValues(row.salesRepresentativeNames),
        salesRepresentativeEmail: joinValues(row.salesRepresentativeEmails),
        salesRepresentativeRole: joinValues(row.salesRepresentativeRoles),
        ownerEmailForImport: primarySalesEmail,
        brokerNames: joinValues(row.brokerNames),
        source: "Old customer import",
        crmProjects: joinValues(row.crmProjects),
        projectNames: joinValues(row.projectNames),
        unitNumbers: joinValues(row.unitNumbers),
        propertyDetails: joinValues(row.propertyDetails),
        unsupportedProperties: joinValues(row.unsupportedProperties),
        rawProjectCodes: joinValues(row.rawProjectCodes),
        rawUnitCodes: joinValues(row.rawUnitCodes),
        rawUnitNames: joinValues(row.rawUnitNames),
        originalRowNumbers: joinValues(row.rowNumbers),
        reviewIssues: joinValues([...new Set(rowIssues)]),
        notesSummary: [
          `Original cari kod: ${joinValues(oldCariKodList)}`,
          `Identity number: ${joinValues(row.identityNumbers)}`,
          row.salesCodes.size ? `Old sales code: ${joinValues(row.salesCodes)}` : "",
          row.salesRepresentativeNames.size
            ? `Sales representative: ${joinValues(row.salesRepresentativeNames)}`
            : "",
          row.brokerNames.size ? `Broker: ${joinValues(row.brokerNames)}` : "",
          row.propertyDetails.size ? `Properties: ${joinValues(row.propertyDetails)}` : "",
          row.unsupportedProperties.size
            ? `Unsupported properties: ${joinValues(row.unsupportedProperties)}`
            : "",
          row.rawEmails.size ? `Raw invalid emails: ${joinValues(row.rawEmails)}` : "",
        ]
          .filter(Boolean)
          .join(" | "),
      };
    })
    .sort((a, b) => a.customerKey.localeCompare(b.customerKey));

  const oneTableWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    oneTableWorkbook,
    toWorksheet(oneTableRows),
    "customers_all_details",
  );
  XLSX.writeFile(oneTableWorkbook, OUTPUT_ONE_TABLE_XLSX);
  writeCsv(OUTPUT_ONE_TABLE_CSV, oneTableRows);

  if (WRITE_RELATIONAL_OUTPUTS) {
    const out = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(out, toWorksheet(customers), "customers_clean");
    XLSX.utils.book_append_sheet(out, toWorksheet(units), "customer_units_clean");
    XLSX.utils.book_append_sheet(out, toWorksheet(salesCodeRows), "sales_code_mapping");
    XLSX.utils.book_append_sheet(out, toWorksheet(issues), "issues");
    XLSX.writeFile(out, OUTPUT_XLSX);

    writeCsv(OUTPUT_CUSTOMERS_CSV, customers);
    writeCsv(OUTPUT_UNITS_CSV, units);
    writeCsv(OUTPUT_ISSUES_CSV, issues);
  }

  console.log(`Read rows: ${rows.length}`);
  console.log(`Clean customers: ${customers.length}`);
  console.log(`Clean units: ${units.length}`);
  console.log(`One-table customers: ${oneTableRows.length}`);
  console.log(`Issues for review: ${issues.length}`);
  console.log(`Wrote ${OUTPUT_ONE_TABLE_XLSX}`);
  console.log(`Wrote ${OUTPUT_ONE_TABLE_CSV}`);

  if (WRITE_RELATIONAL_OUTPUTS) {
    console.log(`Wrote ${OUTPUT_XLSX}`);
    console.log(`Wrote ${OUTPUT_CUSTOMERS_CSV}`);
    console.log(`Wrote ${OUTPUT_UNITS_CSV}`);
    console.log(`Wrote ${OUTPUT_ISSUES_CSV}`);
  }
}

main();
