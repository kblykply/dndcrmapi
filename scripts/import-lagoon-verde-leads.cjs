/* One-off, idempotent Lagoon Verde import. Dry-run by default; never sends messages.
 * node scripts/import-lagoon-verde-leads.cjs /absolute/input.xlsx /absolute/report-directory [--apply]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Workbook and private report directory are required');
const apply = process.argv.includes('--apply');
const batch = 'lagoon-verde-20261023';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = hash(fs.readFileSync(input));
const book = XLSX.readFile(input);
if (book.SheetNames.length !== 1 || book.SheetNames[0] !== 'Lagoon Verde') throw new Error('Unexpected workbook');
const cells = XLSX.utils.sheet_to_json(book.Sheets['Lagoon Verde'], { header: 1, raw: false, defval: '' });
if (cells[2].join('|') !== '#|İsim|Soy isim|Telefon|Instagram adı|Mesaj tarihi|Görüşme notu|Hatırlatma') throw new Error('Unexpected columns');
const rows = cells.slice(3).filter((r) => r[1]).map((r) => r.map((v) => String(v).trim()));
const normalize = (s) => { const digits = s.replace(/\D/g, ''); return digits.length === 11 && digits.startsWith('0') ? '90' + digits.slice(1) : digits; };
const valid = rows.filter((r) => r[3]);
if (valid.some((r) => !/^905\d{9}$/.test(normalize(r[3])))) throw new Error('Unrecognized phone format');
if (new Set(valid.map((r) => normalize(r[3]))).size !== valid.length) throw new Error('Duplicate phones in source');
const ca = fs.readFileSync(path.resolve(__dirname, '../supabase-ca.crt'), 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000, ssl: { ca, rejectUnauthorized: true } });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
fs.mkdirSync(output, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2), { mode: 0o600 });

(async () => {
  const owner = await db.user.findUnique({ where: { email: 'talha.uygur@dndcyprus.com' } });
  const actor = await db.user.findUnique({ where: { email: 'kubilaykuplay@gmail.com' } });
  if (!owner?.isActive || owner.role !== 'CALLCENTER' || !actor?.isActive || actor.role !== 'ADMIN') throw new Error('Expected active users not found');
  const prior = await db.auditLog.findUnique({ where: { id: batch } });
  if (prior) {
    if (prior.metaJson?.fileHash !== fileHash) throw new Error('Batch already exists with different content');
    console.log(JSON.stringify({ alreadyImported: true, ...prior.metaJson }));
    return;
  }
  const leads = await db.lead.findMany();
  const ordered = [...valid].sort((a, b) => parseInt(b[5], 10) - parseInt(a[5], 10) || Number(a[0]) - Number(b[0]));
  const plans = ordered.map((r) => {
    const phone = normalize(r[3]);
    const matches = leads.filter((l) => normalize(l.phone) === phone);
    const active = matches.filter((l) => !l.archivedAt && !['WON', 'LOST', 'ARCHIVED'].includes(l.status));
    if (active.length > 1) throw new Error(`Ambiguous active match at row ${r[0]}`);
    const existing = active[0];
    const fullName = [r[1], r[2]].filter(Boolean).join(' ');
    const fold = (s) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
    if (matches.some((l) => fold(l.fullName) !== fold(fullName))) throw new Error(`Phone/name conflict at row ${r[0]}`);
    if (existing && (existing.ownerCallCenterId !== owner.id || existing.status !== 'NEW' || existing.assignedManagerId || existing.assignedSalesId)) throw new Error(`Already assigned or progressed lead at row ${r[0]}`);
    const id = existing?.id || `lv20261023_${hash(phone).slice(0, 24)}`;
    const details = [
      'Lagoon Verde — TL ödeme modeli kampanyası',
      `Kaynak dosya: ${path.basename(input)} / Lagoon Verde / Kayıt #${r[0]}`,
      `İsim: ${r[1]}`, `Soy isim: ${r[2] || '—'}`, `Telefon (Excel): ${r[3]}`,
      `Instagram adı: ${r[4] || '—'}`, `Mesaj tarihi: ${r[5]} 2026`,
      'Kaynak: Meta Business Suite gelen kutusu (Instagram / Facebook)',
      `Görüşme notu (Excel):\n${r[6] || '—'}`, `Hatırlatma (Excel):\n${r[7] || '—'}`,
      ...(existing?.source ? [`Önceki CRM kaynağı: ${existing.source}`] : []),
      ...(!existing && matches.length ? [`Önceki kapanmış lead korunmuştur: ${matches.map((l) => l.id).join(', ')}`] : []),
    ].join('\n');
    return { row: r[0], id, fullName, phone: '+' + phone, existing, closedLeadIds: matches.filter((l) => l !== existing).map((l) => l.id), details };
  });
  const summary = { batch, fileHash, total: rows.length, created: plans.filter((p) => !p.existing).length, enriched: plans.filter((p) => p.existing).length, skippedNoPhone: rows.length - valid.length, ownerId: owner.id, ids: plans.map((p) => p.id) };
  write('import-plan.json', { ...summary, plans, skipped: rows.filter((r) => !r[3]) });
  console.log(JSON.stringify({ apply, ...summary }));
  if (!apply) return;
  const now = new Date();
  await db.$transaction(async (tx) => {
    // Serialize retries of this one-off import and protect existing records from concurrent changes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${batch}))`;
    if (await tx.auditLog.findUnique({ where: { id: batch } })) throw new Error('Batch was imported concurrently; rerun to verify');
    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      const data = { ownerCallCenterId: owner.id, newPriorityAt: new Date(now.getTime() - i), source: 'Lagoon Verde · TL ödeme modeli · Meta', notes: [p.existing?.notes, p.details].filter(Boolean).join('\n\n') };
      if (p.existing) {
        const result = await tx.lead.updateMany({ where: { id: p.id, updatedAt: p.existing.updatedAt, status: 'NEW', archivedAt: null }, data });
        if (result.count !== 1) throw new Error(`Lead changed during import: ${p.id}`);
      } else {
        await tx.lead.create({ data: { ...data, id: p.id, fullName: p.fullName, phone: p.phone, status: 'NEW' } });
      }
      await tx.leadActivity.create({ data: { id: `lv-note-${p.id}`, leadId: p.id, type: 'NOTE', summary: 'Lagoon Verde — Excel başvuru detayları', details: p.details, createdById: actor.id } });
      await tx.auditLog.create({ data: { id: `lv-audit-${p.id}`, actorId: actor.id, action: 'LEAD_EXCEL_IMPORT', entityType: 'Lead', entityId: p.id, metaJson: { batch, fileHash, row: p.row, ownerCallCenterId: owner.id, created: !p.existing, closedLeadIds: p.closedLeadIds } } });
    }
    await tx.auditLog.create({ data: { id: batch, actorId: actor.id, action: 'LEAD_EXCEL_IMPORT_BATCH', entityType: 'LeadImport', entityId: batch, metaJson: summary } });
  }, { timeout: 120000, maxWait: 20000 });
  write('import-result.json', { ...summary, importedAt: now.toISOString() });
  console.log('Import committed. No messages sent.');
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); await pool.end(); });
