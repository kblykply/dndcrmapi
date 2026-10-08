import type { ProjectType } from '../common/projects';
import type {
  PaymentProjectGroup,
  PaymentSourceCase,
} from './payment-tracking.types';

const PREFIX_PROJECTS: Record<string, ProjectType> = {
  LJ: 'LA_JOYA',
  LJP: 'LA_JOYA_PERLA',
  LJP2: 'LA_JOYA_PERLA_II',
  LV: 'LAGOON_VERDE',
};

/** Restricted formats observed in Logo; bare prefixes and free text are not evidence. */
function codeProject(value: string | null): PaymentProjectGroup | null {
  const code = value?.trim().toUpperCase() ?? '';
  if (/^GK-ARSA\d+$/.test(code)) return 'GECITKALE_1_ETAP';
  const unit = /^(LJP2|LJP|LJ|LV|S)-[A-Z]\d+[A-Z]?(?:-[A-Z]\d+[A-Z]?)*$/.exec(
    code,
  );
  if (!unit) return null;
  // SOPOT is a different project and has no canonical project in this app.
  return PREFIX_PROJECTS[unit[1]] ?? 'UNKNOWN';
}

function groupIdentity(item: PaymentSourceCase): string {
  const { customerCode, unitCode } = item.identity;
  return customerCode?.trim() && unitCode?.trim()
    ? JSON.stringify(['portfolio', customerCode, unitCode])
    : JSON.stringify(['case', item.key]);
}

/** Classify the full customer/unit portfolio before any currency or payment-type filter. */
export function paymentProjectGroups(
  cases: PaymentSourceCase[],
): Map<string, PaymentProjectGroup> {
  const groups = new Map<string, PaymentSourceCase[]>();
  for (const item of cases) {
    const key = groupIdentity(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const result = new Map<string, PaymentProjectGroup>();
  for (const group of groups.values()) {
    const unitProject = codeProject(group[0].identity.unitCode);
    let projectGroup = unitProject ?? 'UNKNOWN';
    // Unknown units remain unknown even if a payment line mentions a known
    // project. Names and customer details must never substitute for identity.
    if (projectGroup !== 'UNKNOWN') {
      for (const item of group) {
        const codes = [
          ...item.projects.map((project) => project.code),
          ...item.installments.map((installment) => installment.projectCode),
        ];
        if (
          codes.some((code) => {
            const project = codeProject(code);
            return project !== null && project !== unitProject;
          })
        ) {
          projectGroup = 'UNKNOWN';
          break;
        }
      }
    }
    for (const item of group) result.set(item.key, projectGroup);
  }
  return result;
}
