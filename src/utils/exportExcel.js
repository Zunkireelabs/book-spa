import * as XLSX from 'xlsx';

/**
 * Export an array of plain objects to a downloaded .xlsx file.
 * @param {string} filename - without extension
 * @param {Array<Record<string, any>>} rows
 * @param {string} [sheetName]
 */
export function exportRowsToExcel(filename, rows, sheetName = 'Sheet1') {
  exportSheetsToExcel(filename, [{ name: sheetName, rows }]);
}

/**
 * Export multiple sheets to a single downloaded .xlsx file.
 * @param {string} filename - without extension
 * @param {Array<{name: string, rows: Array<Record<string, any>>}>} sheets
 */
export function exportSheetsToExcel(filename, sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    // Excel sheet names: max 31 chars, no []:*?/\ characters.
    const safeName = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet';
    XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  });
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
