// Synthetic data for an imaginary company's Strategy & Operations office.
// Every person, vendor, figure and plan here is made up. Money is integer cents.

export type Org = { id: string; name: string; costCenter: string };

export type Worker = {
  id: string;
  name: string;
  email: string;
  orgId: string;
  title: string;
  managerId: string | null;
  location: string;
  baseSalaryCents: number;
  hireDate: string;
};

export type SupportTier = "L1" | "L2" | "L3";

export type Sow = {
  id: string;
  vendor: string;
  orgId: string;
  tier: SupportTier;
  rateCardCents: number; // agreed hourly rate
  monthlyCapCents: number;
};

export type ContingentWorker = {
  id: string;
  name: string;
  email: string;
  vendor: string;
  sowId: string;
  orgId: string;
  startDate: string;
};

export type InvoiceLine = {
  lineId: string;
  period: string; // YYYY-MM
  vendor: string;
  sowId: string;
  cwId: string;
  hours: number;
  rateCents: number;
  amountCents: number;
};

export type LedgerTotal = { period: string; vendor: string; amountCents: number };

export type Project = {
  id: string;
  name: string;
  orgId: string;
  status: "on_track" | "at_risk" | "off_track" | "done";
  budgetCents: number;
  spendToDateCents: number;
  ownerId: string;
};

export type OrgChange = {
  id: string;
  title: string;
  effectiveDate: string;
  summary: string;
  affectedOrgIds: string[];
  rolesEliminated: number;
  announced: boolean;
};

export const orgs: Org[] = [
  { id: "ENG-PLAT", name: "Platform Engineering", costCenter: "CC-4100" },
  { id: "DATA", name: "Data & Analytics", costCenter: "CC-4200" },
  { id: "DWP", name: "Digital Workplace", costCenter: "CC-4300" },
  { id: "SEC", name: "Security", costCenter: "CC-4400" },
];

export const workers: Worker[] = [
  { id: "W-1001", name: "Maya Okafor", email: "maya.okafor@example.com", orgId: "ENG-PLAT", title: "Director, Platform Engineering", managerId: null, location: "Irvine, CA", baseSalaryCents: 24_500_000, hireDate: "2019-03-11" },
  { id: "W-1002", name: "Daniel Reyes", email: "daniel.reyes@example.com", orgId: "ENG-PLAT", title: "Staff Engineer", managerId: "W-1001", location: "Irvine, CA", baseSalaryCents: 21_000_000, hireDate: "2020-07-06" },
  { id: "W-1003", name: "Priya Natarajan", email: "priya.natarajan@example.com", orgId: "ENG-PLAT", title: "Software Engineer II", managerId: "W-1001", location: "Remote (US)", baseSalaryCents: 15_200_000, hireDate: "2023-01-17" },
  { id: "W-1004", name: "Liam Chen", email: "liam.chen@example.com", orgId: "ENG-PLAT", title: "Software Engineer I", managerId: "W-1002", location: "Irvine, CA", baseSalaryCents: 12_400_000, hireDate: "2025-06-02" },
  { id: "W-1005", name: "Sofia Alvarez", email: "sofia.alvarez@example.com", orgId: "ENG-PLAT", title: "SRE", managerId: "W-1001", location: "Costa Mesa, CA", baseSalaryCents: 16_800_000, hireDate: "2022-09-12" },
  { id: "W-2001", name: "Hannah Brooks", email: "hannah.brooks@example.com", orgId: "DATA", title: "Head of Data", managerId: null, location: "Irvine, CA", baseSalaryCents: 23_000_000, hireDate: "2018-11-05" },
  { id: "W-2002", name: "Omar Haddad", email: "omar.haddad@example.com", orgId: "DATA", title: "Data Engineer", managerId: "W-2001", location: "Remote (US)", baseSalaryCents: 15_600_000, hireDate: "2021-04-19" },
  { id: "W-2003", name: "Grace Kim", email: "grace.kim@example.com", orgId: "DATA", title: "Analytics Engineer", managerId: "W-2001", location: "Irvine, CA", baseSalaryCents: 14_100_000, hireDate: "2024-02-26" },
  { id: "W-2004", name: "Ethan Novak", email: "ethan.novak@example.com", orgId: "DATA", title: "BI Developer", managerId: "W-2001", location: "Anaheim, CA", baseSalaryCents: 11_900_000, hireDate: "2025-10-13" },
  { id: "W-3001", name: "Rachel Moore", email: "rachel.moore@example.com", orgId: "DWP", title: "Manager, Digital Workplace", managerId: null, location: "Irvine, CA", baseSalaryCents: 17_500_000, hireDate: "2017-08-21" },
  { id: "W-3002", name: "Kenji Watanabe", email: "kenji.watanabe@example.com", orgId: "DWP", title: "Power Platform Developer", managerId: "W-3001", location: "Irvine, CA", baseSalaryCents: 13_300_000, hireDate: "2022-03-07" },
  { id: "W-3003", name: "Ava Thompson", email: "ava.thompson@example.com", orgId: "DWP", title: "Endpoint Engineer", managerId: "W-3001", location: "Costa Mesa, CA", baseSalaryCents: 10_800_000, hireDate: "2023-11-27" },
  { id: "W-4001", name: "Marcus Bell", email: "marcus.bell@example.com", orgId: "SEC", title: "Security Lead", managerId: null, location: "Irvine, CA", baseSalaryCents: 22_000_000, hireDate: "2019-12-02" },
  { id: "W-4002", name: "Leila Farahani", email: "leila.farahani@example.com", orgId: "SEC", title: "Security Engineer", managerId: "W-4001", location: "Remote (US)", baseSalaryCents: 16_400_000, hireDate: "2021-08-30" },
  { id: "W-4003", name: "Noah Fischer", email: "noah.fischer@example.com", orgId: "SEC", title: "GRC Analyst", managerId: "W-4001", location: "Irvine, CA", baseSalaryCents: 11_200_000, hireDate: "2024-05-20" },
  { id: "W-4004", name: "Isabel Duarte", email: "isabel.duarte@example.com", orgId: "SEC", title: "Security Analyst", managerId: "W-4001", location: "Long Beach, CA", baseSalaryCents: 10_500_000, hireDate: "2026-02-09" },
];

export const sows: Sow[] = [
  { id: "SOW-101", vendor: "Harbor Point Staffing", orgId: "DWP", tier: "L1", rateCardCents: 4_800, monthlyCapCents: 3_000_000 },
  { id: "SOW-102", vendor: "Harbor Point Staffing", orgId: "DWP", tier: "L2", rateCardCents: 7_200, monthlyCapCents: 2_500_000 },
  { id: "SOW-201", vendor: "Lumen Tech Services", orgId: "ENG-PLAT", tier: "L2", rateCardCents: 8_500, monthlyCapCents: 4_000_000 },
  { id: "SOW-202", vendor: "Lumen Tech Services", orgId: "DATA", tier: "L3", rateCardCents: 12_500, monthlyCapCents: 4_500_000 },
  { id: "SOW-301", vendor: "Cedar Ridge Consulting", orgId: "SEC", tier: "L3", rateCardCents: 14_000, monthlyCapCents: 4_500_000 },
];

export const contingentWorkers: ContingentWorker[] = [
  { id: "CW-01", name: "Tyler Grant", email: "tyler.grant@harborpoint.example", vendor: "Harbor Point Staffing", sowId: "SOW-101", orgId: "DWP", startDate: "2025-09-01" },
  { id: "CW-02", name: "Mia Santos", email: "mia.santos@harborpoint.example", vendor: "Harbor Point Staffing", sowId: "SOW-101", orgId: "DWP", startDate: "2026-01-12" },
  { id: "CW-03", name: "Jordan Lee", email: "jordan.lee@harborpoint.example", vendor: "Harbor Point Staffing", sowId: "SOW-101", orgId: "DWP", startDate: "2026-04-06" },
  { id: "CW-04", name: "Chloe Martin", email: "chloe.martin@harborpoint.example", vendor: "Harbor Point Staffing", sowId: "SOW-102", orgId: "DWP", startDate: "2025-11-03" },
  { id: "CW-05", name: "Arjun Mehta", email: "arjun.mehta@lumentech.example", vendor: "Lumen Tech Services", sowId: "SOW-201", orgId: "ENG-PLAT", startDate: "2025-07-14" },
  { id: "CW-06", name: "Elena Petrova", email: "elena.petrova@lumentech.example", vendor: "Lumen Tech Services", sowId: "SOW-201", orgId: "ENG-PLAT", startDate: "2026-03-02" },
  { id: "CW-07", name: "Samuel Okoye", email: "samuel.okoye@lumentech.example", vendor: "Lumen Tech Services", sowId: "SOW-202", orgId: "DATA", startDate: "2025-10-20" },
  { id: "CW-08", name: "Nina Kowalski", email: "nina.kowalski@lumentech.example", vendor: "Lumen Tech Services", sowId: "SOW-202", orgId: "DATA", startDate: "2026-06-15" },
  { id: "CW-09", name: "Victor Huang", email: "victor.huang@cedarridge.example", vendor: "Cedar Ridge Consulting", sowId: "SOW-301", orgId: "SEC", startDate: "2026-02-23" },
  { id: "CW-10", name: "Zoe Adams", email: "zoe.adams@cedarridge.example", vendor: "Cedar Ridge Consulting", sowId: "SOW-301", orgId: "SEC", startDate: "2026-08-10" },
];

function line(lineId: string, cwId: string, hours: number, rateCents: number, period = "2026-10"): InvoiceLine {
  const cw = contingentWorkers.find((c) => c.id === cwId);
  if (!cw) throw new Error(`unknown CW ${cwId}`);
  return { lineId, period, vendor: cw.vendor, sowId: cw.sowId, cwId, hours, rateCents, amountCents: Math.round(hours * rateCents) };
}

// October 2026 vendor invoice export, as it would come out of the AP system's spreadsheet.
// Planted issues (the README lists them): CW-02 billed above the SOW-101 rate card,
// and CW-06's line appears twice on the Lumen invoice.
export const invoiceLines: InvoiceLine[] = [
  line("HP-1001", "CW-01", 160, 4_800),
  line("HP-1002", "CW-02", 152, 5_400),
  line("HP-1003", "CW-03", 120, 4_800),
  line("HP-1004", "CW-04", 168, 7_200),
  line("LT-2001", "CW-05", 160, 8_500),
  line("LT-2002", "CW-06", 144, 8_500),
  line("LT-2003", "CW-06", 144, 8_500),
  line("LT-2004", "CW-07", 168, 12_500),
  line("LT-2005", "CW-08", 96, 12_500),
  line("CR-3001", "CW-09", 160, 14_000),
  line("CR-3002", "CW-10", 140.5, 14_000),
];

function sumFor(vendor: string, exclude: string[] = []): number {
  return invoiceLines
    .filter((l) => l.vendor === vendor && !exclude.includes(l.lineId))
    .reduce((s, l) => s + l.amountCents, 0);
}

// What AP actually approved for payment (source of truth). Lumen's duplicate line was not paid.
export const ledgerTotals: LedgerTotal[] = [
  { period: "2026-10", vendor: "Harbor Point Staffing", amountCents: sumFor("Harbor Point Staffing") },
  { period: "2026-10", vendor: "Lumen Tech Services", amountCents: sumFor("Lumen Tech Services", ["LT-2003"]) },
  { period: "2026-10", vendor: "Cedar Ridge Consulting", amountCents: sumFor("Cedar Ridge Consulting") },
];

export const projects: Project[] = [
  { id: "PRJ-501", name: "Identity platform consolidation", orgId: "SEC", status: "at_risk", budgetCents: 85_000_000, spendToDateCents: 71_200_000, ownerId: "W-4001" },
  { id: "PRJ-502", name: "Data warehouse migration", orgId: "DATA", status: "on_track", budgetCents: 120_000_000, spendToDateCents: 54_300_000, ownerId: "W-2001" },
  { id: "PRJ-503", name: "Copilot rollout wave 2", orgId: "DWP", status: "off_track", budgetCents: 40_000_000, spendToDateCents: 43_900_000, ownerId: "W-3001" },
  { id: "PRJ-504", name: "Internal developer portal", orgId: "ENG-PLAT", status: "on_track", budgetCents: 60_000_000, spendToDateCents: 18_750_000, ownerId: "W-1001" },
  { id: "PRJ-505", name: "Laptop refresh FY26", orgId: "DWP", status: "done", budgetCents: 32_000_000, spendToDateCents: 30_480_000, ownerId: "W-3001" },
];

export const orgChanges: OrgChange[] = [
  {
    id: "OC-2027-01",
    title: "Combine Digital Workplace into Platform Engineering",
    effectiveDate: "2027-01-15",
    summary:
      "Digital Workplace moves under the Platform Engineering director. Endpoint support shifts to the Harbor Point L1 SOW; two FTE roles are not backfilled.",
    affectedOrgIds: ["DWP", "ENG-PLAT"],
    rolesEliminated: 2,
    announced: false,
  },
];
