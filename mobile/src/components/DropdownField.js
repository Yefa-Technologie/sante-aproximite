import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, R } from "../theme";

export function DropdownField({
  label,
  placeholder,
  selectedLabel,
  options,
  getOptionKey = (option) => option.code,
  renderOption,
  isOpen,
  onToggle,
  onSelect,
  disabled,
  emptyText,
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        style={[styles.dropdownHeader, disabled && { opacity: 0.5 }]}
        onPress={disabled ? undefined : onToggle}
      >
        <Text style={[styles.dropdownHeaderText, !selectedLabel && { color: C.textLight }]} numberOfLines={1}>
          {selectedLabel || placeholder}
        </Text>
        <Text style={styles.dropdownArrow}>{isOpen ? "▴" : "▾"}</Text>
      </Pressable>
      {isOpen ? (
        <View style={styles.dropdownList}>
          {options.length ? (
            <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
              {options.map((option) => (
                <Pressable
                  key={getOptionKey(option)}
                  style={styles.dropdownItem}
                  onPress={() => onSelect(getOptionKey(option))}
                >
                  <Text style={styles.dropdownItemText}>{renderOption(option)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.dropdownEmptyText}>{emptyText}</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.textMed },
  dropdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  dropdownHeaderText: { flex: 1, color: C.textDark, fontSize: 14, marginRight: 8 },
  dropdownArrow: { color: C.textMuted, fontSize: 12, fontWeight: "700" },
  dropdownList: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    backgroundColor: C.surface,
    marginTop: 6,
    overflow: "hidden",
  },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.border },
  dropdownItemText: { color: C.textMed, fontSize: 14 },
  dropdownEmptyText: { padding: 12, color: C.textMuted, fontSize: 13 },
});
