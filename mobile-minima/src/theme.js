// Design system — Santé Aproximité
export const C = {
  // Brand
  primary:      "#1A56DB",
  primaryDark:  "#1337A4",
  primaryLight: "#EBF1FF",

  // Functional accents
  teal:         "#0891B2",
  tealLight:    "#E0F7FA",
  green:        "#059669",
  greenLight:   "#D1FAE5",
  orange:       "#EA580C",
  orangeLight:  "#FFF0E6",
  red:          "#DC2626",
  redLight:     "#FEE2E2",
  amber:        "#D97706",
  amberLight:   "#FFFBEB",
  purple:       "#7C3AED",
  purpleLight:  "#EDE9FE",

  // Surfaces
  bg:           "#F0F4F8",
  surface:      "#FFFFFF",
  surfaceAlt:   "#F8FAFC",

  // Borders
  border:       "#E2E8F0",
  borderDark:   "#CBD5E1",

  // Text
  textDark:     "#0F172A",
  textMed:      "#334155",
  textMuted:    "#64748B",
  textLight:    "#94A3B8",

  // Status
  statusNew:          "#3B82F6",
  statusNewBg:        "#EFF6FF",
  statusInProgress:   "#F59E0B",
  statusInProgressBg: "#FFFBEB",
  statusResolved:     "#10B981",
  statusResolvedBg:   "#ECFDF5",
  statusRejected:     "#EF4444",
  statusRejectedBg:   "#FEF2F2",
};

export const R = {
  xs:   6,
  sm:   10,
  md:   14,
  lg:   18,
  xl:   22,
  full: 999,
};

export const S = {
  sm: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  },
};

// Shared component styles
export const shared = {
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: "#0F172A",
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderColor: "#E2E8F0",
    borderWidth: 1,
    padding: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    backgroundColor: "#F8FAFC",
  },
  chipActive: {
    backgroundColor: "#1A56DB",
    borderColor: "#1A56DB",
  },
  chipText: {
    color: "#334155",
    fontWeight: "600",
    fontSize: 13,
  },
  chipTextActive: {
    color: "#FFFFFF",
  },
  primaryBtn: {
    backgroundColor: "#1A56DB",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#1A56DB",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryBtn: {
    borderWidth: 1.5,
    borderColor: "#1A56DB",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#EBF1FF",
  },
  secondaryBtnText: {
    color: "#1A56DB",
    fontWeight: "700",
    fontSize: 14,
  },
  dangerBtn: {
    borderWidth: 1.5,
    borderColor: "#DC2626",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  dangerBtnText: {
    color: "#DC2626",
    fontWeight: "700",
    fontSize: 14,
  },
  error:   { color: "#DC2626", fontSize: 13, fontWeight: "600" },
  success: { color: "#059669", fontSize: 13, fontWeight: "600" },
  hint:    { color: "#64748B", fontSize: 12 },
};
