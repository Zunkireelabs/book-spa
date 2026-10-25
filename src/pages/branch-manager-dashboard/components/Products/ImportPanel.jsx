import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { PanelShell, FormBody, Field, InlineError } from '../../../../components/ui/PanelFormKit';
import { importProducts, createSupplier, createProductCategory } from '../../../../services/api';
import { IMPORT_COLUMNS, IMPORT_HEADINGS, parseImportSheet, sheetErrors } from '../../../../services/productsView';
import { friendlyError } from '../../../../utils/friendlyError';
import { csvDownload } from '../Area/listKit';

// Import products (V25): pick a CSV or Excel file, see what would happen (new / updates matched by SKU, then by name + size / rows to
// fix) before anything is written, choose the branch that gets opening stock, then Import. All or nothing: any row to fix blocks it.
// A missing supplier or category can be created from the row ("Create it") and the file is checked again.
export const downloadTemplate = () => csvDownload('products-template.csv', IMPORT_COLUMNS.map((c) => IMPORT_HEADINGS[c]), [
  ['Lavender massage oil', 'Himalayan Herbals', '500 ml', '', '', 'LAV-500', '', '950', '1800', '8', '12', '24'],
  ['Lavender massage oil', 'Himalayan Herbals', '1 L', '', '', 'LAV-1L', '', '1520', '3200', '4', '6', '9'],
]);

const ImportPanel = ({ branches, branchId, onClose, onDone, width }) => {
  const [file, setFile] = useState(null);
  const [sheet, setSheet] = useState(null); // parseImportSheet result
  const [preview, setPreview] = useState(null); // dry-run result
  const [branch, setBranch] = useState(branchId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fixing, setFixing] = useState('');
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const check = useCallback(async (rows, br) => {
    setBusy(true); setError(null);
    const { data, error: err } = await importProducts({ rows, branchId: br || null, dryRun: true });
    setBusy(false);
    if (err) { setError(friendlyError(err, 'Could not check the file.')); setPreview(null); return; }
    setPreview(data);
  }, []);

  const readFile = async (f) => {
    if (!f) return;
    setError(null); setPreview(null); setSheet(null); setFile(f);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      const parsed = parseImportSheet(table);
      setSheet(parsed);
      if (parsed.problems.length === 0) await check(parsed.rows, branch);
    } catch (e) {
      setError('That file could not be read. Use a .csv or .xlsx file.');
    }
  };

  useEffect(() => { if (sheet && sheet.problems.length === 0) check(sheet.rows, branch); }, [branch]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = preview ? sheetErrors(preview.errors, sheet?.rowNumbers) : [];
  const fixable = errors.filter((e) => e.create);
  const why = !sheet ? 'Choose a file' : sheet.problems.length ? sheet.problems[0] : !preview ? 'Checking…' : errors.length ? `Fix ${errors.length} row${errors.length === 1 ? '' : 's'} first` : (preview.new + preview.updated === 0 ? 'Nothing to import' : '');

  const createIt = async (e) => {
    setFixing(`${e.create.type}:${e.create.name}`);
    const res = e.create.type === 'supplier' ? await createSupplier({ name: e.create.name }) : await createProductCategory({ name: e.create.name, description: null });
    setFixing('');
    if (res.error) { setError(friendlyError(res.error, `Could not create "${e.create.name}".`)); return; }
    await check(sheet.rows, branch);
  };

  const run = async () => {
    if (why || busy) return;
    setBusy(true); setError(null);
    const { data, error: err } = await importProducts({ rows: sheet.rows, branchId: branch || null, dryRun: false });
    setBusy(false);
    if (err) { setError(friendlyError(err, 'The import failed, nothing was changed.')); return; }
    if (!data.imported) { setPreview(data); setError('Some rows still need fixing. Nothing was imported.'); return; }
    onDone(`Imported: ${data.new} new, ${data.updated} updated`);
  };

  const total = preview ? preview.new + preview.updated : 0;
  return (
    <PanelShell width={width} variant="panel" title="Import products" onClose={onClose} dirty={!!file} busy={busy} reason={why}
      primary={{ label: busy ? 'Working…' : `Import ${total || ''} product${total === 1 ? '' : 's'}`.replace('Import  ', 'Import '), onClick: run, disabled: !!why, loading: busy && !!preview }}>
      <FormBody>
        <InlineError message={error} />
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files?.[0]); }}
            className={`rounded-xl border border-dashed px-5 py-9 text-center ${over ? 'border-primary bg-[#F2F6F0]' : 'border-[#D3D5D0]'}`}>
            <Icon name="Upload" size={24} className="text-[#8A8A90] mx-auto mb-2" />
            <p className="text-[13.5px] font-medium text-text-primary">Drop a CSV or Excel file here</p>
            <button type="button" onClick={() => inputRef.current?.click()} className="mt-2 text-[13px] font-medium text-primary hover:underline" data-choose-file>or choose a file</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 border border-border rounded-[10px] px-3.5 py-3">
            <Icon name="FileText" size={18} className="text-[#8A8A90] flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-text-primary truncate">{file.name}</p>
              <p className="text-[12.5px] text-[#8A8A90]">{sheet ? `${sheet.rows.length} rows` : 'Reading…'}</p>
            </div>
            <button type="button" onClick={() => inputRef.current?.click()} className="h-8 px-3 rounded-md border border-border bg-white text-[13px] font-medium hover:bg-[#FAFAF9]">Change file</button>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" data-import-file onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />

        {sheet && sheet.problems.length > 0 && (
          <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-[#F3D9A4] bg-[#FFFBEB] px-3.5 py-3 text-[13px] text-[#92400E]">
            <Icon name="AlertTriangle" size={15} className="mt-0.5 flex-shrink-0" /><div>{sheet.problems.map((p) => <p key={p}>{p}</p>)}</div>
          </div>
        )}

        {preview && (
          <>
            <dl className="border border-border rounded-[10px] divide-y divide-[#F1F1EF] text-[13px] tabular-nums" data-import-summary>
              <div className="flex justify-between px-3.5 py-2.5"><dt>New products or sizes</dt><dd className="font-medium">{preview.new}</dd></div>
              <div className="flex justify-between px-3.5 py-2.5"><dt>Updates <span className="text-[#8A8A90]">matched by SKU, then name + size</span></dt><dd className="font-medium">{preview.updated}</dd></div>
              <div className="flex justify-between px-3.5 py-2.5"><dt className={errors.length ? 'text-[#991B1B]' : ''}>Need fixing</dt><dd className={`font-medium ${errors.length ? 'text-[#991B1B]' : ''}`}>{errors.length}</dd></div>
            </dl>
            {errors.length > 0 && (
              <div role="alert" className="rounded-[10px] border border-[#F3D9A4] bg-[#FFFBEB] px-3.5 py-3 text-[13px] text-[#92400E] space-y-1" data-import-errors>
                <p className="font-medium flex items-center gap-2"><Icon name="AlertTriangle" size={15} />Nothing is imported until these are fixed</p>
                {errors.slice(0, 12).map((e) => (
                  <p key={`${e.row}:${e.message}`}>Row {e.row} · {e.message}
                    {e.create && <> · <button type="button" disabled={!!fixing} onClick={() => createIt(e)} className="font-semibold underline disabled:opacity-50">{fixing === `${e.create.type}:${e.create.name}` ? 'Creating…' : 'Create it'}</button></>}
                  </p>
                ))}
                {errors.length > 12 && <p>…and {errors.length - 12} more</p>}
                {fixable.length > 1 && <p className="text-[12.5px]">Create the missing ones above, or fix the file and choose it again.</p>}
              </div>
            )}
            {(preview.stock_ignored_untracked || []).length > 0 && (
              <p className="text-[12.5px] text-[#92400E]" data-stock-untracked>
                Opening stock is not saved for {preview.stock_ignored_untracked.join(', ')}: {preview.stock_ignored_untracked.length === 1 ? "it doesn't" : "they don't"} count stock. Turn on “Count stock” for {preview.stock_ignored_untracked.length === 1 ? 'it' : 'them'} first, then receive the stock.
              </p>
            )}
            {preview.stock_ignored > (preview.stock_ignored_untracked || []).length && (
              <p className="text-[12.5px] text-[#8A8A90]" data-stock-ignored>Rows that update an existing size keep their stock. Updates never change stock; use Receive or Set the real count for those.</p>
            )}
          </>
        )}

        <Field label="Opening stock goes to" id="imp-branch" hint="Only for new products or sizes. It is saved as “Opening stock” in the stock history.">
          <CustomSelect value={branch} onChange={setBranch} placeholder="Select branch" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        </Field>
        <p className="text-[12.5px] text-[#8A8A90]">
          Columns: {IMPORT_COLUMNS.map((c) => IMPORT_HEADINGS[c].toLowerCase()).join(', ')}. Suppliers and categories must already exist.{' '}
          <button type="button" onClick={downloadTemplate} className="font-medium text-primary hover:underline" data-template>Download the template</button>. Export gives the same columns, so you can edit in Excel and import back.
        </p>
      </FormBody>
    </PanelShell>
  );
};

export default ImportPanel;
