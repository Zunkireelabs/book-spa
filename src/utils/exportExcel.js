import * as XLSX from 'xlsx';

/**
 * Export an array of plain objects to a downloaded .xlsx file.
 * @param {string} filename - without extension
 * @param {Array<Record<string, any>>} rows
 * @param {string} [sheetName]
 */
export function exportRowsToExcel(filename, rows, sheetName = 'Sheet1') {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
