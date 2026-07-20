export function safeGetString(record, fieldName) {
    if (!record) return '';
    try {
        return record.getCellValueAsString(fieldName) || '';
    } catch {
        return '';
    }
}

export function safeGetValue(record, fieldName) {
    if (!record) return null;
    try {
        return record.getCellValue(fieldName);
    } catch {
        return null;
    }
}

export function hasField(table, fieldName) {
    return table.getFieldIfExists(fieldName) != null;
}
