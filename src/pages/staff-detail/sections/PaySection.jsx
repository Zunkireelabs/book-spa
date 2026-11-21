import React from 'react';
import Input from '../../../components/ui/Input';
import { FormRow, Changed, Loading, Problem, Note, KV, npr } from './ui';

const NumberBox = ({ value, onChange, suffix, prefix, disabled, ariaLabel }) => (
  <div className="flex items-center">
    {prefix && <span className="h-10 px-3 inline-flex items-center border border-r-0 border-border rounded-l-spa bg-background text-sm text-text-secondary">{prefix}</span>}
    <Input type="number" min="0" step="any" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={ariaLabel} className={prefix ? 'rounded-l-none' : ''} />
    {suffix && <span className="ml-2 text-sm text-text-secondary">{suffix}</span>}
  </div>
);

const monthText = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

const PaySection = ({
  editing, pay, setPay, savedPay, canEdit, loading, error, onRetry, earnings, earningsLoading, earningsError, periodMonth,
  goPayroll, canOpenPayroll, staffLabel = 'team member', isServiceStaff = true,
}) => {
  if (loading && !pay) return <Loading />;
  if (error) return <Problem message={error} onRetry={onRetry} />;
  if (!pay) return null;
  const c = (k) => String(pay[k]) !== String(savedPay[k]) && !(Number(pay[k] || 0) === Number(savedPay[k] || 0));
  const set = (k) => (v) => setPay((p) => ({ ...p, [k]: v }));
  const e = earnings;
  const rates = e?.rates || {};
  const deduction = Number(e?.productCommissionDeduction) || 0;

  return (
    <div>
      {editing ? (
        <div className="mt-2">
          <FormRow title="Salary" hint="Paid monthly in the pay run.">
            <Changed on={c('monthlySalary')} className="max-w-xs" field="monthlySalary">
              <NumberBox prefix="NPR" value={pay.monthlySalary} onChange={set('monthlySalary')} disabled={!canEdit} ariaLabel="Monthly salary" />
            </Changed>
          </FormRow>
          <FormRow title="Commission" hint="Earned on completed, paid visits and on product sales." last>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
              <Changed on={c('commissionRate')} field="commissionRate">
                <label className="block text-sm text-text-primary mb-1">Services</label>
                <NumberBox suffix="%" value={pay.commissionRate} onChange={set('commissionRate')} disabled={!canEdit} ariaLabel="Service commission percent" />
              </Changed>
              <Changed on={c('productCommissionRate')} field="productCommissionRate">
                <label className="block text-sm text-text-primary mb-1">Products</label>
                <NumberBox suffix="%" value={pay.productCommissionRate} onChange={set('productCommissionRate')} disabled={!canEdit} ariaLabel="Product commission percent" />
              </Changed>
            </div>
          </FormRow>
        </div>
      ) : (
        <KV items={[
          { label: 'Monthly salary', value: Number(pay.monthlySalary) ? npr(pay.monthlySalary) : null },
          ...(isServiceStaff ? [{ label: 'Commission', value: `${Number(pay.commissionRate) || 0}% on services · ${Number(pay.productCommissionRate) || 0}% on products` }] : []),
        ]} />
      )}
      {!canEdit && <div className="mt-3"><Note icon="Lock">You can see pay but only an admin can change it.</Note></div>}

      {isServiceStaff && !editing && (
        <div className="mt-6 rounded-xl bg-background px-[18px] py-4">
          {earningsLoading ? <Loading /> : earningsError ? <Problem message={earningsError} /> : e ? (
            <>
              {[
                [`Service commission${rates.service != null ? ` · ${rates.service}% of ${npr(e.serviceRevenue)}` : ''}`, e.serviceCommission],
                ...(Number(e.referralCommission) ? [['Referral commission', e.referralCommission]] : []),
                [`Product commission${rates.product != null ? ` · ${rates.product}%${e.productRevenue != null ? ` of ${npr(e.productRevenue)}` : ''}` : ''}`, e.productCommission],
                ...(deduction ? [['Product refunds deducted', -deduction]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 text-sm text-text-secondary tabular-nums"><span>{k}</span><b className="font-medium text-text-primary">{v < 0 ? `− ${npr(-v)}` : npr(v)}</b></div>
              ))}
              <div className="flex justify-between border-t border-border mt-1.5 pt-2.5 text-sm text-text-primary tabular-nums"><span>Commission so far in {monthText(periodMonth)}</span><b className="font-semibold">{npr(e.total)}</b></div>
            </>
          ) : null}
        </div>
      )}
      {!editing && <p className="mt-2 text-xs text-text-secondary">Salary and attendance deductions are not part of the commission total; Payroll applies them in the pay run.</p>}
      {!editing && e?.lastPayRun ? (
        <div className="mt-3"><Note icon="BarChart3">Last pay run: {monthText(e.lastPayRun.periodMonth)}, {npr(e.lastPayRun.netPay)}{e.lastPayRun.status ? ` (${e.lastPayRun.status})` : ''}. {canOpenPayroll && <button type="button" onClick={goPayroll} className="text-primary underline">Open Payroll</button>}</Note></div>
      ) : !editing && e ? <div className="mt-3"><Note icon="BarChart3">No pay run for this {staffLabel.toLowerCase()} yet. {canOpenPayroll && <button type="button" onClick={goPayroll} className="text-primary underline">Open Payroll</button>}</Note></div> : null}
    </div>
  );
};

export default PaySection;
