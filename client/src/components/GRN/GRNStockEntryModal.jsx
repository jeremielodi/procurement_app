// src/components/GRN/GRNStockEntryModal.jsx
// Entrée en stock, APRÈS la réception, d'une ligne de GRN restée hors stock (texte libre ou article alors non stockable) :
// article stockable du catalogue, dépôt (celui du GRN s'il en a un), lot / péremption ou n° de série selon l'article.
// La quantité est la quantité acceptée de la ligne (non modifiable).
import { useEffect, useState } from 'react';
import { Warehouse } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '../Common/Modal';
import SearchSelect from '../Common/SearchSelect';
import CatalogAutocomplete from '../Stock/CatalogAutocomplete';
import SerialNumbersHelp from '../Stock/SerialNumbersHelp';
import { grnService } from '../../services/grnService';
import { warehouseService } from '../../services/stockService';
import { t, getLocale } from '../../i18n';

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const today = () => new Date().toISOString().slice(0, 10);
const fmtQty = (n) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 4 }).format(Number(n) || 0);

export default function GRNStockEntryModal({ grn, item, onClose, onDone }) {
  // Article déjà lié à la ligne (rattaché mais alors non stockable) : imposé
  const linked = item.stock_item_id
    ? { id: item.stock_item_id, code: item.item_code, name: item.item_name, unit: item.unit, is_stockable: item.is_stockable,
        track_lots: item.track_lots, track_expiry: item.track_expiry, track_serials: item.track_serials }
    : null;
  const [stockItem, setStockItem] = useState(linked);
  const [warehouses, setWarehouses] = useState(null);
  const [warehouseId, setWarehouseId] = useState(grn.warehouse_id || '');
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [serialsText, setSerialsText] = useState('');
  const [saving, setSaving] = useState(false);
  const accepted = Number(item.quantity_accepted) || 0;

  useEffect(() => {
    if (grn.warehouse_id) return; // dépôt imposé : celui de la réception
    warehouseService.mine()
      .then(r => {
        const list = r.data || [];
        setWarehouses(list);
        if (list.length === 1) setWarehouseId(list[0].id);
      })
      .catch(() => setWarehouses([]));
  }, [grn.warehouse_id]);

  const serials = serialsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(serialNumber => ({ serialNumber })); // n° d'inventaire attribué automatiquement
  const notStockable = stockItem && !stockItem.is_stockable;
  const canSubmit = !!stockItem && !notStockable && !!warehouseId && !saving
    && (!stockItem.track_lots || lotNumber.trim())
    && (!stockItem.track_expiry || expiryDate)
    && (!stockItem.track_serials || serials.length === accepted);

  const submit = async () => {
    setSaving(true);
    try {
      await grnService.stockEntry(grn.id, item.id, {
        stockItemId: stockItem.id,
        warehouseId: grn.warehouse_id ? undefined : warehouseId,
        ...(stockItem.track_lots ? { lotNumber: lotNumber.trim(), expiryDate: expiryDate || null } : {}),
        ...(stockItem.track_serials ? { serials } : {}),
      });
      toast.success(t('grn.stockEntry.done', { item: item.item_description, qty: `${fmtQty(accepted)} ${stockItem.unit || ''}`.trim() }));
      onDone();
    } catch (err) {
      const data = err.response?.data || {};
      const key = `grn.err.${data.code}`;
      const label = data.code && t(key) !== key ? t(key) : null;
      toast.error(label ? `${label}${data.message ? ` — ${data.message}` : ''}` : (data.message || t('common.errorOccurred')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => !saving && onClose()}
      title={t('grn.stockEntry.title', { item: item.item_description })}
      size="md"
      confirmText={t('grn.stockEntry.confirm')}
      onConfirm={submit}
      confirmDisabled={!canSubmit}
      isLoading={saving}
    >
      <div className="space-y-4 text-sm" data-testid="grn-stock-entry">
        <p className="text-gray-600">{t('grn.stockEntry.intro', { qty: fmtQty(accepted) })}</p>

        <div>
          <label className="mb-1 block font-medium text-gray-700">{linked ? t('grn.stockEntry.itemLinked') : t('grn.stockEntry.item')}</label>
          {linked ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="font-semibold">{linked.code}</span> — {linked.name}
            </div>
          ) : (
            <CatalogAutocomplete linked={stockItem} onLink={setStockItem} placeholder={t('grn.linkItem')}
              className={inputCls} minChars={1} />
          )}
          {notStockable && <p className="mt-1 text-xs text-red-600">{t('grn.stockEntry.notStockable')}</p>}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
          <span className="text-gray-600">{t('grn.stockEntry.quantity')}</span>
          <b>{fmtQty(accepted)} {stockItem?.unit || ''}</b>
        </div>

        <div>
          <label htmlFor="grn-stock-entry-warehouse" className="mb-1 flex items-center gap-2 font-medium text-gray-700">
            <Warehouse size={14} className="text-gray-500" /> {t('grn.stockEntry.warehouse')}
          </label>
          {grn.warehouse_id ? (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">{grn.warehouse_name} {grn.warehouse_location && `(${grn.warehouse_location})`}</div>
              <p className="mt-1 text-xs text-gray-500">{t('grn.stockEntry.warehouseFixed')}</p>
            </>
          ) : warehouses === null ? (
            <div className="text-gray-400">…</div>
          ) : warehouses.length === 0 ? (
            <p className="text-red-600">{t('grn.err.NO_WAREHOUSE_ACCESS')}</p>
          ) : (
            <SearchSelect id="grn-stock-entry-warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
              className={inputCls} data-testid="grn-stock-entry-warehouse">
              {warehouses.length > 1 && <option value="">{t('grn.chooseWarehouse')}</option>}
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.location_name} — {w.name} ({w.code})</option>)}
            </SearchSelect>
          )}
        </div>

        {stockItem?.is_stockable && stockItem.track_lots && (
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} placeholder={t('grn.lotNumber')} aria-label={t('grn.lotNumber')}
              value={lotNumber} onChange={e => setLotNumber(e.target.value)} />
            <input type="date" className={inputCls} min={today()} aria-label={t('grn.expiryDate')}
              title={stockItem.track_expiry ? t('grn.expiryDate') : t('grn.expiryOptional')}
              value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
          </div>
        )}

        {stockItem?.is_stockable && stockItem.track_serials && (
          <div className="grid gap-1">
            <textarea rows={Math.min(Math.max(accepted, 2), 6)} className={`${inputCls} font-mono text-xs`}
              placeholder={t('grn.serialsPlaceholder')} aria-label={t('grn.serials')} title={t('grn.serialsHint')}
              value={serialsText} onChange={e => setSerialsText(e.target.value)} />
            <SerialNumbersHelp text={serialsText} expected={Number.isInteger(accepted) ? accepted : undefined} />
          </div>
        )}
      </div>
    </Modal>
  );
}
